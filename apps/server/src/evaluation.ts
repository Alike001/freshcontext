import { readFile } from 'node:fs/promises';

export interface EvaluationMetrics {
  readonly truePositives: number;
  readonly trueNegatives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly falsePositiveIds: readonly string[];
  readonly falseNegativeIds: readonly string[];
}

export interface EvaluationEvidence {
  readonly path: string;
  readonly qualifiedName: string;
}

export type EvaluationClassification =
  'true_positive' | 'true_negative' | 'false_positive' | 'false_negative';

export interface PublicRepositoryProvenanceReadModel {
  readonly kind: 'public_repository';
  readonly repository: string;
  readonly url: string;
  readonly beforeCommit: string;
  readonly afterCommit: string;
  readonly license: string;
  readonly sourcePaths: readonly string[];
}

export interface EvaluationMcpRecallReadModel {
  readonly status: 'ready';
  readonly indexedCommit: string;
  readonly returnedMemoryIds: readonly string[];
  readonly withheldMemoryIds: readonly string[];
  readonly abstained: boolean;
  readonly abstentionReason: 'no_memory' | 'all_matching_memory_unsafe' | null;
}

export interface EvaluationMcpReceiptReadModel {
  readonly caseId: string;
  readonly client: '@modelcontextprotocol/sdk Client';
  readonly transport: 'linked in-process MCP transport';
  readonly tool: 'freshcontext_recall';
  readonly registeredTools: readonly string[];
  readonly input: {
    readonly repositoryId: string;
    readonly path: string;
    readonly qualifiedName: string;
    readonly beforeCommit: string;
    readonly afterCommit: string;
  };
  readonly memoryId: string;
  readonly beforeChange: EvaluationMcpRecallReadModel;
  readonly afterChange: EvaluationMcpRecallReadModel;
}

export interface EvaluationLabelReadModel {
  readonly id: string;
  readonly claim: string;
  readonly evidence: EvaluationEvidence;
  readonly expectedAffected: boolean;
  readonly graph: {
    readonly affected: boolean;
    readonly classification: EvaluationClassification;
    readonly callHops: number | null;
    readonly actualPath: readonly EvaluationEvidence[] | null;
  };
  readonly directFileBaseline: {
    readonly affected: boolean;
    readonly classification: EvaluationClassification;
  };
}

export interface EvaluationCaseReadModel {
  readonly caseId: string;
  readonly description: string;
  readonly changeSummary: string;
  readonly provenance: PublicRepositoryProvenanceReadModel | null;
  readonly beforeCommit: string;
  readonly afterCommit: string;
  readonly labelCount: number;
  readonly changedSymbolCount: number;
  readonly unresolvedCallCount: number;
  readonly labels: readonly EvaluationLabelReadModel[];
  readonly graph: EvaluationMetrics;
  readonly directFileBaseline: EvaluationMetrics;
}

export interface EvaluationReadModel {
  readonly status: 'ready';
  readonly source: 'verified_reference';
  readonly evaluationId: string;
  readonly completedAt: string;
  readonly command: 'pnpm evaluate';
  readonly engine: 'HydraDB OSS v0.1.1';
  readonly traversalBoundary: 'zero to three reverse call hops';
  readonly dataset: {
    readonly status: 'complete';
    readonly source: 'versioned real Git fixtures';
    readonly caseCount: number;
    readonly labelCount: number;
  };
  readonly cases: readonly EvaluationCaseReadModel[];
  readonly mcpReceipt: EvaluationMcpReceiptReadModel;
  readonly aggregate: {
    readonly graph: EvaluationMetrics;
    readonly directFileBaseline: EvaluationMetrics;
  };
}

export interface EvaluationGateway {
  read(): Promise<EvaluationReadModel>;
}

export class FileEvaluationGateway implements EvaluationGateway {
  constructor(private readonly artifactPath: string) {}

  async read(): Promise<EvaluationReadModel> {
    const text = await readFile(this.artifactPath, 'utf8');
    return parseEvaluationArtifact(JSON.parse(text) as unknown);
  }
}

export function parseEvaluationArtifact(value: unknown): EvaluationReadModel {
  const artifact = requiredRecord(value, 'evaluation artifact');
  requiredLiteral(artifact, 'schemaVersion', 1);
  const evaluationId = requiredBoundedString(artifact, 'evaluationId', 128);
  const completedAt = requiredIsoTimestamp(artifact, 'completedAt');
  requiredLiteral(artifact, 'command', 'pnpm evaluate');
  requiredLiteral(artifact, 'engine', 'HydraDB OSS v0.1.1');
  requiredLiteral(artifact, 'traversalBoundary', 'zero to three reverse call hops');

  const datasetRecord = requiredRecord(artifact['dataset'], 'evaluation dataset');
  requiredLiteral(datasetRecord, 'status', 'complete');
  requiredLiteral(datasetRecord, 'source', 'versioned real Git fixtures');
  const dataset = {
    status: 'complete' as const,
    source: 'versioned real Git fixtures' as const,
    caseCount: requiredCount(datasetRecord, 'caseCount'),
    labelCount: requiredCount(datasetRecord, 'labelCount'),
  };

  const caseValues = requiredArray(artifact, 'cases');
  const cases = caseValues.map(parseEvaluationCase);
  if (dataset.caseCount !== cases.length) {
    throw new Error('Evaluation case count does not match its cases');
  }
  if (dataset.labelCount !== cases.reduce((sum, entry) => sum + entry.labelCount, 0)) {
    throw new Error('Evaluation label count does not match its cases');
  }
  const mcpReceipt = parseMcpReceipt(artifact['mcpReceipt'], cases);

  const aggregateRecord = requiredRecord(artifact['aggregate'], 'evaluation aggregate');
  const aggregate = {
    graph: parseMetrics(aggregateRecord['graph'], dataset.labelCount, 'aggregate graph'),
    directFileBaseline: parseMetrics(
      aggregateRecord['directFileBaseline'],
      dataset.labelCount,
      'aggregate direct-file baseline',
    ),
  };
  assertMetricsMatchLabels(aggregate.graph, cases, 'graph');
  assertMetricsMatchLabels(aggregate.directFileBaseline, cases, 'directFileBaseline');

  return {
    status: 'ready',
    source: 'verified_reference',
    evaluationId,
    completedAt,
    command: 'pnpm evaluate',
    engine: 'HydraDB OSS v0.1.1',
    traversalBoundary: 'zero to three reverse call hops',
    dataset,
    cases,
    mcpReceipt,
    aggregate,
  };
}

function parseEvaluationCase(value: unknown): EvaluationCaseReadModel {
  const entry = requiredRecord(value, 'evaluation case');
  const caseId = requiredBoundedString(entry, 'caseId', 128);
  const labelCount = requiredCount(entry, 'labelCount');
  const labels = requiredArray(entry, 'labels').map((label) => parseEvaluationLabel(caseId, label));
  if (labelCount !== labels.length)
    throw new Error(`Evaluation case ${caseId} label count differs`);
  const result = {
    caseId,
    description: requiredBoundedString(entry, 'description', 1_000),
    changeSummary: requiredBoundedString(entry, 'changeSummary', 1_000),
    provenance: parsePublicProvenance(entry['provenance']),
    beforeCommit: requiredGitSha(entry, 'beforeCommit'),
    afterCommit: requiredGitSha(entry, 'afterCommit'),
    labelCount,
    changedSymbolCount: requiredCount(entry, 'changedSymbolCount'),
    unresolvedCallCount: requiredCount(entry, 'unresolvedCallCount'),
    labels,
    graph: parseMetrics(entry['graph'], labelCount, `${caseId} graph`),
    directFileBaseline: parseMetrics(
      entry['directFileBaseline'],
      labelCount,
      `${caseId} direct-file baseline`,
    ),
  };
  assertMetricsMatchLabels(result.graph, [result], 'graph');
  assertMetricsMatchLabels(result.directFileBaseline, [result], 'directFileBaseline');
  return result;
}

function parsePublicProvenance(value: unknown): PublicRepositoryProvenanceReadModel | null {
  if (value === null) return null;
  const provenance = requiredRecord(value, 'public repository provenance');
  requiredLiteral(provenance, 'kind', 'public_repository');
  const result = {
    kind: 'public_repository' as const,
    repository: requiredBoundedString(provenance, 'repository', 300),
    url: requiredBoundedString(provenance, 'url', 1_000),
    beforeCommit: requiredGitSha(provenance, 'beforeCommit'),
    afterCommit: requiredGitSha(provenance, 'afterCommit'),
    license: requiredBoundedString(provenance, 'license', 300),
    sourcePaths: stringArray(provenance['sourcePaths'], 'provenance source paths'),
  };
  if (!result.url.startsWith('https://github.com/') || result.sourcePaths.length === 0) {
    throw new Error('Evaluation public repository provenance is invalid');
  }
  return result;
}

function parseMcpReceipt(
  value: unknown,
  cases: readonly EvaluationCaseReadModel[],
): EvaluationMcpReceiptReadModel {
  const receipt = requiredRecord(value, 'MCP receipt');
  requiredLiteral(receipt, 'client', '@modelcontextprotocol/sdk Client');
  requiredLiteral(receipt, 'transport', 'linked in-process MCP transport');
  requiredLiteral(receipt, 'tool', 'freshcontext_recall');
  const input = requiredRecord(receipt['input'], 'MCP receipt input');
  const result = {
    caseId: requiredBoundedString(receipt, 'caseId', 128),
    client: '@modelcontextprotocol/sdk Client' as const,
    transport: 'linked in-process MCP transport' as const,
    tool: 'freshcontext_recall' as const,
    registeredTools: stringArray(receipt['registeredTools'], 'MCP registered tools'),
    input: {
      repositoryId: requiredBoundedString(input, 'repositoryId', 200),
      path: requiredBoundedString(input, 'path', 1_000),
      qualifiedName: requiredBoundedString(input, 'qualifiedName', 1_000),
      beforeCommit: requiredGitSha(input, 'beforeCommit'),
      afterCommit: requiredGitSha(input, 'afterCommit'),
    },
    memoryId: requiredBoundedString(receipt, 'memoryId', 200),
    beforeChange: parseMcpRecall(receipt['beforeChange']),
    afterChange: parseMcpRecall(receipt['afterChange']),
  };
  const sourceCase = cases.find(({ caseId }) => caseId === result.caseId);
  const receiptLabel = sourceCase?.labels.find(
    ({ evidence }) =>
      evidence.path === result.input.path && evidence.qualifiedName === result.input.qualifiedName,
  );
  if (
    !sourceCase?.provenance ||
    !receiptLabel?.expectedAffected ||
    receiptLabel.graph.classification !== 'true_positive' ||
    result.input.beforeCommit !== sourceCase.beforeCommit ||
    result.input.afterCommit !== sourceCase.afterCommit ||
    result.beforeChange.indexedCommit !== sourceCase.beforeCommit ||
    result.afterChange.indexedCommit !== sourceCase.afterCommit
  ) {
    throw new Error('Evaluation MCP receipt does not match its public source case');
  }
  const expectedTools = ['freshcontext_recall', 'freshcontext_remember', 'freshcontext_status'];
  if (JSON.stringify(result.registeredTools) !== JSON.stringify(expectedTools)) {
    throw new Error('Evaluation MCP receipt has an unexpected tool surface');
  }
  if (
    result.beforeChange.abstained ||
    result.beforeChange.abstentionReason !== null ||
    !result.beforeChange.returnedMemoryIds.includes(result.memoryId) ||
    result.beforeChange.withheldMemoryIds.length !== 0 ||
    !result.afterChange.abstained ||
    result.afterChange.abstentionReason !== 'all_matching_memory_unsafe' ||
    result.afterChange.returnedMemoryIds.length !== 0 ||
    !result.afterChange.withheldMemoryIds.includes(result.memoryId)
  ) {
    throw new Error('Evaluation MCP receipt does not prove recall then abstention');
  }
  return result;
}

function parseMcpRecall(value: unknown): EvaluationMcpRecallReadModel {
  const recall = requiredRecord(value, 'MCP recall result');
  requiredLiteral(recall, 'status', 'ready');
  const reason = recall['abstentionReason'];
  if (reason !== null && reason !== 'no_memory' && reason !== 'all_matching_memory_unsafe') {
    throw new Error('Evaluation MCP recall has an invalid abstention reason');
  }
  return {
    status: 'ready',
    indexedCommit: requiredGitSha(recall, 'indexedCommit'),
    returnedMemoryIds: stringArray(recall['returnedMemoryIds'], 'returned memory ids'),
    withheldMemoryIds: stringArray(recall['withheldMemoryIds'], 'withheld memory ids'),
    abstained: requiredBoolean(recall, 'abstained'),
    abstentionReason: reason,
  };
}

function parseEvaluationLabel(caseId: string, value: unknown): EvaluationLabelReadModel {
  const label = requiredRecord(value, 'evaluation label');
  const id = requiredBoundedString(label, 'id', 128);
  const expectedAffected = requiredBoolean(label, 'expectedAffected');
  const graphRecord = requiredRecord(label['graph'], 'graph prediction');
  const graphAffected = requiredBoolean(graphRecord, 'affected');
  const graphClassification = requiredClassification(graphRecord, 'classification');
  if (graphClassification !== classification(expectedAffected, graphAffected)) {
    throw new Error(`Evaluation label ${caseId}:${id} has an invalid graph classification`);
  }
  const callHops = nullableCallHops(graphRecord['callHops']);
  const actualPath = nullableEvidencePath(graphRecord['actualPath']);
  if (graphAffected) {
    if (callHops === null || actualPath === null || actualPath.length !== callHops + 1) {
      throw new Error(`Evaluation label ${caseId}:${id} has an invalid graph path`);
    }
  } else if (callHops !== null || actualPath !== null) {
    throw new Error(`Unaffected evaluation label ${caseId}:${id} cannot have a graph path`);
  }

  const baselineRecord = requiredRecord(label['directFileBaseline'], 'baseline prediction');
  const baselineAffected = requiredBoolean(baselineRecord, 'affected');
  const baselineClassification = requiredClassification(baselineRecord, 'classification');
  if (baselineClassification !== classification(expectedAffected, baselineAffected)) {
    throw new Error(`Evaluation label ${caseId}:${id} has an invalid baseline classification`);
  }

  return {
    id,
    claim: requiredBoundedString(label, 'claim', 2_000),
    evidence: parseEvidence(label['evidence']),
    expectedAffected,
    graph: {
      affected: graphAffected,
      classification: graphClassification,
      callHops,
      actualPath,
    },
    directFileBaseline: {
      affected: baselineAffected,
      classification: baselineClassification,
    },
  };
}

function parseMetrics(value: unknown, expectedTotal: number, name: string): EvaluationMetrics {
  const metrics = requiredRecord(value, `${name} metrics`);
  const result = {
    truePositives: requiredCount(metrics, 'truePositives'),
    trueNegatives: requiredCount(metrics, 'trueNegatives'),
    falsePositives: requiredCount(metrics, 'falsePositives'),
    falseNegatives: requiredCount(metrics, 'falseNegatives'),
    precision: nullableScore(metrics['precision'], 'precision'),
    recall: nullableScore(metrics['recall'], 'recall'),
    falsePositiveIds: stringArray(metrics['falsePositiveIds'], 'false-positive ids'),
    falseNegativeIds: stringArray(metrics['falseNegativeIds'], 'false-negative ids'),
  };
  const total =
    result.truePositives + result.trueNegatives + result.falsePositives + result.falseNegatives;
  if (total !== expectedTotal) throw new Error(`${name} confusion matrix has the wrong total`);
  if (result.falsePositiveIds.length !== result.falsePositives) {
    throw new Error(`${name} false-positive ids do not match the count`);
  }
  if (result.falseNegativeIds.length !== result.falseNegatives) {
    throw new Error(`${name} false-negative ids do not match the count`);
  }
  const expectedPrecision = ratio(
    result.truePositives,
    result.truePositives + result.falsePositives,
  );
  const expectedRecall = ratio(result.truePositives, result.truePositives + result.falseNegatives);
  if (
    !sameScore(result.precision, expectedPrecision) ||
    !sameScore(result.recall, expectedRecall)
  ) {
    throw new Error(`${name} scores do not match its confusion matrix`);
  }
  return result;
}

function assertMetricsMatchLabels(
  metrics: EvaluationMetrics,
  cases: readonly EvaluationCaseReadModel[],
  field: 'graph' | 'directFileBaseline',
): void {
  const labels = cases.flatMap((entry) =>
    entry.labels.map((label) => ({ caseId: entry.caseId, label })),
  );
  const classifications = labels.map(({ label }) => label[field].classification);
  const count = (value: EvaluationClassification) =>
    classifications.filter((entry) => entry === value).length;
  if (
    metrics.truePositives !== count('true_positive') ||
    metrics.trueNegatives !== count('true_negative') ||
    metrics.falsePositives !== count('false_positive') ||
    metrics.falseNegatives !== count('false_negative')
  ) {
    throw new Error(`Aggregate ${field} metrics do not match its labels`);
  }
  const falsePositiveIds = labels
    .filter(({ label }) => label[field].classification === 'false_positive')
    .map(({ caseId, label }) => `${caseId}:${label.id}`)
    .sort();
  const falseNegativeIds = labels
    .filter(({ label }) => label[field].classification === 'false_negative')
    .map(({ caseId, label }) => `${caseId}:${label.id}`)
    .sort();
  if (
    JSON.stringify(metrics.falsePositiveIds) !== JSON.stringify(falsePositiveIds) ||
    JSON.stringify(metrics.falseNegativeIds) !== JSON.stringify(falseNegativeIds)
  ) {
    throw new Error(`Aggregate ${field} error ids do not match its labels`);
  }
}

function parseEvidence(value: unknown): EvaluationEvidence {
  const evidence = requiredRecord(value, 'evaluation evidence');
  return {
    path: requiredBoundedString(evidence, 'path', 1_000),
    qualifiedName: requiredBoundedString(evidence, 'qualifiedName', 1_000),
  };
}

function nullableEvidencePath(value: unknown): readonly EvaluationEvidence[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new Error('Evaluation graph path must contain one to four steps');
  }
  return value.map(parseEvidence);
}

function nullableCallHops(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > 3) {
    throw new Error('Evaluation call hops must be between zero and three');
  }
  return value;
}

function requiredClassification(
  value: Readonly<Record<string, unknown>>,
  key: string,
): EvaluationClassification {
  const entry = value[key];
  if (
    entry !== 'true_positive' &&
    entry !== 'true_negative' &&
    entry !== 'false_positive' &&
    entry !== 'false_negative'
  ) {
    throw new Error(`Expected ${key} to be an evaluation classification`);
  }
  return entry;
}

function classification(expected: boolean, affected: boolean): EvaluationClassification {
  if (expected) return affected ? 'true_positive' : 'false_negative';
  return affected ? 'false_positive' : 'true_negative';
}

function requiredRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${name} to be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredArray(value: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const entry = value[key];
  if (!Array.isArray(entry)) throw new Error(`Expected ${key} to be an array`);
  return entry;
}

function requiredCount(value: Readonly<Record<string, unknown>>, key: string): number {
  const entry = value[key];
  if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) {
    throw new Error(`Expected ${key} to be a non-negative integer`);
  }
  return entry;
}

function requiredBoolean(value: Readonly<Record<string, unknown>>, key: string): boolean {
  const entry = value[key];
  if (typeof entry !== 'boolean') throw new Error(`Expected ${key} to be a boolean`);
  return entry;
}

function requiredBoundedString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number,
): string {
  const entry = value[key];
  if (
    typeof entry !== 'string' ||
    entry.length === 0 ||
    entry.length > maximumLength ||
    entry.trim() !== entry
  ) {
    throw new Error(`Expected ${key} to be a bounded non-empty string`);
  }
  return entry;
}

function requiredIsoTimestamp(value: Readonly<Record<string, unknown>>, key: string): string {
  const timestamp = requiredBoundedString(value, key, 64);
  if (new Date(timestamp).toISOString() !== timestamp) throw new Error(`Expected ${key} to be ISO`);
  return timestamp;
}

function requiredGitSha(value: Readonly<Record<string, unknown>>, key: string): string {
  const sha = requiredBoundedString(value, key, 64);
  if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw new Error(`Expected ${key} to be a full Git SHA`);
  return sha;
}

function requiredLiteral(
  value: Readonly<Record<string, unknown>>,
  key: string,
  expected: string | number,
): void {
  if (value[key] !== expected) throw new Error(`Evaluation ${key} is unsupported`);
}

function nullableScore(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Evaluation ${name} must be between zero and one`);
  }
  return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`Evaluation ${name} must be strings`);
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new Error(`Evaluation ${name} must be strings`);
    return entry;
  });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function sameScore(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < Number.EPSILON * 4;
}
