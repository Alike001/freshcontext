import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  INSPECT_MEMORY_IMPACTS_QUERY,
  MemoryService,
  SyncService,
  parseEntityPayload,
  type RecallResult,
} from '@freshcontext/core';
import { ImmutableGraphStore, type HydraQueryGateway } from '@freshcontext/graph';
import type { HydraQueryResponse } from '@freshcontext/hydra';
import {
  buildRepositorySnapshot,
  classifySymbolChanges,
  indexRepository,
  inspectRepository,
} from '@freshcontext/indexer';

import { calculateBinaryMetrics, type BinaryLabel } from './metrics.js';
import { startMcpProofSession, type McpProofSession } from './mcp-proof.js';
import type {
  EvaluationArtifact,
  EvaluationCaseResult,
  EvaluationClassification,
  EvaluationEvidence,
  EvaluationLabelResult,
  EvaluationMcpRecallResult,
  EvaluationMcpReceipt,
  PublicRepositoryProvenance,
} from './types.js';

const execFileAsync = promisify(execFile);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesDirectory = resolve(packageDirectory, '../../evaluation/cases');

interface CaseManifest {
  readonly caseId: string;
  readonly description: string;
  readonly changeSummary: string;
  readonly provenance: PublicRepositoryProvenance | null;
  readonly mcpReceiptLabelId: string | null;
  readonly labels: readonly CaseLabel[];
}

interface CaseLabel {
  readonly id: string;
  readonly claim: string;
  readonly path: string;
  readonly qualifiedName: string;
  readonly expected: boolean;
  readonly expectedPath: readonly EvaluationEvidence[] | null;
}

export async function runEvaluation(hydra: HydraQueryGateway): Promise<EvaluationArtifact> {
  const caseIds = (await readdir(casesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareText);
  if (caseIds.length === 0) throw new Error('Evaluation dataset contains no cases');
  const cases: EvaluationCaseResult[] = [];
  const graphLabels: BinaryLabel[] = [];
  const baselineLabels: BinaryLabel[] = [];
  let mcpReceipt: EvaluationMcpReceipt | null = null;
  for (const caseId of caseIds) {
    const result = await runCase(hydra, caseId);
    cases.push(result.caseResult);
    graphLabels.push(...result.graphLabels);
    baselineLabels.push(...result.baselineLabels);
    if (result.mcpReceipt) {
      if (mcpReceipt) throw new Error('Evaluation dataset defines more than one MCP receipt');
      mcpReceipt = result.mcpReceipt;
    }
  }
  if (!mcpReceipt) throw new Error('Evaluation dataset does not define an MCP receipt');
  const result = {
    schemaVersion: 1,
    command: 'pnpm evaluate',
    engine: 'HydraDB OSS v0.1.1',
    traversalBoundary: 'zero to three reverse call hops',
    dataset: {
      status: 'complete',
      source: 'versioned real Git fixtures',
      caseCount: cases.length,
      labelCount: graphLabels.length,
    },
    cases,
    mcpReceipt,
    aggregate: {
      graph: calculateBinaryMetrics(graphLabels),
      directFileBaseline: calculateBinaryMetrics(baselineLabels),
    },
  } as const;
  return {
    ...result,
    evaluationId: createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 16),
    completedAt: new Date().toISOString(),
  };
}

async function runCase(
  hydra: HydraQueryGateway,
  caseId: string,
): Promise<{
  caseResult: EvaluationCaseResult;
  graphLabels: BinaryLabel[];
  baselineLabels: BinaryLabel[];
  mcpReceipt: EvaluationMcpReceipt | null;
}> {
  const source = resolve(casesDirectory, caseId);
  const manifest = parseCaseManifest(await readFile(resolve(source, 'case.json'), 'utf8'));
  if (manifest.caseId !== caseId) throw new Error(`Case id mismatch for ${caseId}`);
  const repositoryPath = await mkdtemp(resolve(tmpdir(), `freshcontext-evaluation-${caseId}-`));
  let proofSession: McpProofSession | null = null;
  try {
    await cp(resolve(source, 'before'), repositoryPath, { recursive: true });
    await initializeGit(repositoryPath);
    const repositoryId = `evaluation-${caseId}`;
    const graph = new ImmutableGraphStore(hydra);
    const baseline = await indexRepository({ repositoryId, repositoryPath, graph });
    const memory = new MemoryService({
      graph,
      hydra,
      clock: () => new Date('2026-08-12T12:00:00.000Z'),
    });
    const memoryIds = new Map<string, string>();
    for (const label of manifest.labels) {
      const record = await memory.remember({
        repositoryId,
        commitSha: baseline.snapshot.commit.sha,
        claim: label.claim,
        evidence: [{ path: label.path, qualifiedName: label.qualifiedName }],
      });
      memoryIds.set(label.id, record.memoryId);
    }

    const receiptLabel = manifest.mcpReceiptLabelId
      ? manifest.labels.find(({ id }) => id === manifest.mcpReceiptLabelId)
      : undefined;
    proofSession = receiptLabel ? await startMcpProofSession(memory) : null;
    const beforeRecall =
      proofSession && receiptLabel
        ? await proofSession.recall({
            repositoryId,
            commitSha: baseline.snapshot.commit.sha,
            path: receiptLabel.path,
            qualifiedName: receiptLabel.qualifiedName,
          })
        : null;

    await cp(resolve(source, 'after'), repositoryPath, {
      recursive: true,
      force: true,
    });
    await git(repositoryPath, ['add', '.'], '2026-08-13T12:00:00Z');
    await git(repositoryPath, ['commit', '-m', 'apply evaluated change'], '2026-08-13T12:00:00Z');
    const afterSnapshot = buildRepositorySnapshot(
      repositoryId,
      await inspectRepository(repositoryPath),
    );
    const changes = classifySymbolChanges(baseline.snapshot.symbols, afterSnapshot.symbols);
    const changedFiles = new Set(
      changes.flatMap((change) => [change.before?.path, change.after?.path]).filter(isString),
    );
    const synchronized = await new SyncService({ graph, hydra }).synchronize({
      repositoryId,
      repositoryPath,
    });
    const impacted = new Set(synchronized.impactedMemoryIds);
    let mcpReceipt: EvaluationMcpReceipt | null = null;
    if (proofSession && receiptLabel && beforeRecall) {
      const afterRecall = await proofSession.recall({
        repositoryId,
        commitSha: afterSnapshot.commit.sha,
        path: receiptLabel.path,
        qualifiedName: receiptLabel.qualifiedName,
      });
      const memoryId = requiredMemoryId(memoryIds, receiptLabel.id);
      assertMcpReceiptTransition(beforeRecall, afterRecall, memoryId);
      mcpReceipt = {
        caseId,
        client: '@modelcontextprotocol/sdk Client',
        transport: 'linked in-process MCP transport',
        tool: 'freshcontext_recall',
        registeredTools: proofSession.registeredTools,
        input: {
          repositoryId,
          path: receiptLabel.path,
          qualifiedName: receiptLabel.qualifiedName,
          beforeCommit: baseline.snapshot.commit.sha,
          afterCommit: afterSnapshot.commit.sha,
        },
        memoryId,
        beforeChange: mcpRecallResult(beforeRecall),
        afterChange: mcpRecallResult(afterRecall),
      };
    }
    const graphLabels = manifest.labels.map((label) => ({
      id: `${caseId}:${label.id}`,
      expected: label.expected,
      predicted: impacted.has(requiredMemoryId(memoryIds, label.id)),
    }));
    const baselineLabels = manifest.labels.map((label) => ({
      id: `${caseId}:${label.id}`,
      expected: label.expected,
      predicted: changedFiles.has(label.path),
    }));
    const labels = await Promise.all(
      manifest.labels.map(async (label, index): Promise<EvaluationLabelResult> => {
        const graphLabel = requiredLabel(graphLabels, index);
        const baselineLabel = requiredLabel(baselineLabels, index);
        const handle = await memory.getMemory(repositoryId, requiredMemoryId(memoryIds, label.id));
        if (!handle) throw new Error(`Evaluation memory ${label.id} disappeared`);
        const proof = graphLabel.predicted
          ? await inspectImpact(graph, hydra, handle.entity.id)
          : null;
        return {
          id: label.id,
          claim: label.claim,
          evidence: { path: label.path, qualifiedName: label.qualifiedName },
          expectedAffected: label.expected,
          expectedPath: label.expectedPath,
          graph: {
            affected: graphLabel.predicted,
            classification: classification(graphLabel),
            callHops: proof?.callHops ?? null,
            actualPath: proof?.path ?? null,
          },
          directFileBaseline: {
            affected: baselineLabel.predicted,
            classification: classification(baselineLabel),
          },
        };
      }),
    );
    return {
      graphLabels,
      baselineLabels,
      mcpReceipt,
      caseResult: {
        caseId,
        description: manifest.description,
        changeSummary: manifest.changeSummary,
        provenance: manifest.provenance,
        beforeCommit: baseline.snapshot.commit.sha,
        afterCommit: afterSnapshot.commit.sha,
        labelCount: manifest.labels.length,
        changedSymbolCount: changes.length,
        unresolvedCallCount: afterSnapshot.statistics.unresolvedCallCount,
        labels,
        graph: calculateBinaryMetrics(graphLabels),
        directFileBaseline: calculateBinaryMetrics(baselineLabels),
      },
    };
  } finally {
    try {
      if (proofSession) await proofSession.close();
    } finally {
      await rm(repositoryPath, { recursive: true, force: true });
    }
  }
}

export function parseCaseManifest(text: string): CaseManifest {
  const value = JSON.parse(text) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('caseId' in value) ||
    typeof value.caseId !== 'string' ||
    !('description' in value) ||
    typeof value.description !== 'string' ||
    !('changeSummary' in value) ||
    typeof value.changeSummary !== 'string' ||
    !('labels' in value) ||
    !Array.isArray(value.labels)
  ) {
    throw new Error('Invalid evaluation case manifest');
  }
  assertNonEmpty('caseId', value.caseId);
  assertNonEmpty('description', value.description);
  assertNonEmpty('changeSummary', value.changeSummary);
  const provenance = parseProvenance('provenance' in value ? value.provenance : null);
  const mcpReceiptLabelId =
    'mcpReceiptLabelId' in value && value.mcpReceiptLabelId !== null
      ? requiredManifestText(value.mcpReceiptLabelId, 'MCP receipt label id')
      : null;
  const labels = value.labels.map((label: unknown) => {
    if (
      typeof label !== 'object' ||
      label === null ||
      !('id' in label) ||
      typeof label.id !== 'string' ||
      !('claim' in label) ||
      typeof label.claim !== 'string' ||
      !('path' in label) ||
      typeof label.path !== 'string' ||
      !('qualifiedName' in label) ||
      typeof label.qualifiedName !== 'string' ||
      !('expected' in label) ||
      typeof label.expected !== 'boolean' ||
      !('expectedPath' in label)
    ) {
      throw new Error('Invalid evaluation label');
    }
    assertNonEmpty('label id', label.id);
    assertNonEmpty('claim', label.claim);
    assertNonEmpty('evidence path', label.path);
    assertNonEmpty('qualified name', label.qualifiedName);
    const expectedPath = parseExpectedPath(label.expectedPath);
    if (label.expected !== (expectedPath !== null)) {
      throw new Error('Affected evaluation labels need a path and unaffected labels must use null');
    }
    const endpoint = expectedPath?.at(-1);
    if (
      endpoint &&
      (endpoint.path !== label.path || endpoint.qualifiedName !== label.qualifiedName)
    ) {
      throw new Error('Expected impact path must end at the memory evidence');
    }
    return {
      id: label.id,
      claim: label.claim,
      path: label.path,
      qualifiedName: label.qualifiedName,
      expected: label.expected,
      expectedPath,
    };
  });
  if (new Set(labels.map((label) => label.id)).size !== labels.length) {
    throw new Error('Evaluation label ids must be unique');
  }
  if (labels.length === 0) throw new Error('Evaluation case must contain labels');
  if (mcpReceiptLabelId) {
    const receiptLabel = labels.find(({ id }) => id === mcpReceiptLabelId);
    if (!receiptLabel?.expected) {
      throw new Error('MCP receipt label must identify an affected evaluation label');
    }
    if (!provenance) throw new Error('MCP receipt requires public repository provenance');
  }
  return {
    caseId: value.caseId,
    description: value.description,
    changeSummary: value.changeSummary,
    provenance,
    mcpReceiptLabelId,
    labels,
  };
}

function parseProvenance(value: unknown): PublicRepositoryProvenance | null {
  if (value === null) return null;
  const record = isRecord(value) ? value : null;
  if (!record || record['kind'] !== 'public_repository') {
    throw new Error('Invalid public repository provenance');
  }
  const sourcePaths = record['sourcePaths'];
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw new Error('Public repository provenance needs source paths');
  }
  const parsed = {
    kind: 'public_repository' as const,
    repository: requiredManifestText(record['repository'], 'provenance repository'),
    url: requiredManifestText(record['url'], 'provenance URL'),
    beforeCommit: requiredManifestText(record['beforeCommit'], 'provenance before commit'),
    afterCommit: requiredManifestText(record['afterCommit'], 'provenance after commit'),
    license: requiredManifestText(record['license'], 'provenance license'),
    sourcePaths: sourcePaths.map((path) => requiredManifestText(path, 'provenance source path')),
  };
  if (!/^https:\/\/github\.com\//u.test(parsed.url)) {
    throw new Error('Public repository provenance URL must use GitHub HTTPS');
  }
  if (!/^[a-f0-9]{40}$/u.test(parsed.beforeCommit) || !/^[a-f0-9]{40}$/u.test(parsed.afterCommit)) {
    throw new Error('Public repository provenance commits must be full Git SHAs');
  }
  return parsed;
}

function requiredManifestText(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${name}`);
  assertNonEmpty(name, value);
  return value;
}

function assertMcpReceiptTransition(
  before: RecallResult,
  after: RecallResult,
  memoryId: string,
): void {
  if (
    before.status !== 'ready' ||
    before.abstained ||
    !before.memories.some((memory) => memory.memoryId === memoryId) ||
    before.withheldCount !== 0
  ) {
    throw new Error('MCP receipt did not return the current memory before the change');
  }
  if (
    after.status !== 'ready' ||
    !after.abstained ||
    after.memories.length !== 0 ||
    after.abstentionReason !== 'all_matching_memory_unsafe' ||
    !after.withheldMemoryIds.includes(memoryId)
  ) {
    throw new Error('MCP receipt did not abstain on the unsafe memory after the change');
  }
}

function mcpRecallResult(result: RecallResult): EvaluationMcpRecallResult {
  return {
    status: 'ready',
    indexedCommit: result.indexedCommit,
    returnedMemoryIds: result.memories.map(({ memoryId }) => memoryId),
    withheldMemoryIds: result.withheldMemoryIds,
    abstained: result.abstained,
    abstentionReason: result.abstentionReason,
  };
}

function parseExpectedPath(value: unknown): readonly EvaluationEvidence[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid expected impact path');
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : null;
    if (
      !record ||
      typeof record['path'] !== 'string' ||
      typeof record['qualifiedName'] !== 'string'
    ) {
      throw new Error('Invalid expected impact path step');
    }
    assertNonEmpty('expected path', record['path']);
    assertNonEmpty('expected qualified name', record['qualifiedName']);
    return { path: record['path'], qualifiedName: record['qualifiedName'] };
  });
}

async function inspectImpact(
  graph: ImmutableGraphStore,
  hydra: HydraQueryGateway,
  memoryEntityId: number,
): Promise<{ callHops: number; path: readonly EvaluationEvidence[] }> {
  const response = await hydra.query(INSPECT_MEMORY_IMPACTS_QUERY, {
    parameters: { memoryId: memoryEntityId },
    consistency: 'strong',
  });
  if (response.rows.length !== 1) {
    throw new Error(`Expected one impact proof, received ${response.rows.length}`);
  }
  const impactId = requiredNumberCell(response, 0, 'impactId');
  const stored = await graph.inspectEntity(impactId);
  if (!stored || stored.kind !== 'Impact') throw new Error('Impact proof is missing or corrupt');
  const properties = parseEntityPayload(stored).properties;
  const callHops = properties['callHops'];
  const pathSignature = properties['pathSignature'];
  if (
    typeof callHops !== 'number' ||
    !Number.isSafeInteger(callHops) ||
    typeof pathSignature !== 'string'
  ) {
    throw new Error('Impact proof payload is invalid');
  }
  const path = pathSignature.split(' -> ').slice(0, -1).map(parseSymbolRevisionKey);
  if (path.length !== callHops + 1) throw new Error('Impact proof path length is inconsistent');
  return { callHops, path };
}

function parseSymbolRevisionKey(entityKey: string): EvaluationEvidence {
  const match = /:file:([^:]+):symbol:([^:]+)$/u.exec(entityKey);
  if (!match?.[1] || !match[2]) throw new Error('Impact path contains an unreadable symbol key');
  return { path: decodeURIComponent(match[1]), qualifiedName: decodeURIComponent(match[2]) };
}

function classification(label: BinaryLabel): EvaluationClassification {
  if (label.expected) return label.predicted ? 'true_positive' : 'false_negative';
  return label.predicted ? 'false_positive' : 'true_negative';
}

function requiredLabel(labels: readonly BinaryLabel[], index: number): BinaryLabel {
  const label = labels[index];
  if (!label) throw new Error(`Evaluation label index ${index} is missing`);
  return label;
}

function requiredNumberCell(response: HydraQueryResponse, row: number, column: string): number {
  const index = response.columns.indexOf(column);
  const value = index >= 0 ? response.rows[row]?.[index] : undefined;
  if (
    !value ||
    (value.type !== 'integer' && value.type !== 'signed_integer' && value.type !== 'vertex_id') ||
    !Number.isSafeInteger(value.value)
  ) {
    throw new Error(`HydraDB omitted integer column ${column}`);
  }
  return value.value;
}

async function initializeGit(root: string): Promise<void> {
  await git(root, ['init', '--initial-branch=main'], '2026-08-12T12:00:00Z');
  await git(root, ['config', 'user.name', 'FreshContext Evaluation'], '2026-08-12T12:00:00Z');
  await git(
    root,
    ['config', 'user.email', 'evaluation@freshcontext.local'],
    '2026-08-12T12:00:00Z',
  );
  await git(root, ['add', '.'], '2026-08-12T12:00:00Z');
  await git(root, ['commit', '-m', 'evaluation baseline'], '2026-08-12T12:00:00Z');
}

async function git(root: string, args: readonly string[], timestamp: string): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: timestamp, GIT_COMMITTER_DATE: timestamp },
  });
}

function requiredMemoryId(ids: ReadonlyMap<string, string>, labelId: string): string {
  const memoryId = ids.get(labelId);
  if (!memoryId) throw new Error(`Evaluation label ${labelId} has no memory id`);
  return memoryId;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be non-empty without surrounding whitespace`);
  }
}
