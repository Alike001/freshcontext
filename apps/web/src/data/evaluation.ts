import { useCallback, useEffect, useState } from 'react';

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

export interface EvaluationLabel {
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

export interface EvaluationCase {
  readonly caseId: string;
  readonly description: string;
  readonly changeSummary: string;
  readonly labelCount: number;
  readonly changedSymbolCount: number;
  readonly unresolvedCallCount: number;
  readonly labels: readonly EvaluationLabel[];
  readonly graph: EvaluationMetrics;
  readonly directFileBaseline: EvaluationMetrics;
}

export interface EvaluationResponse {
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
  readonly cases: readonly EvaluationCase[];
  readonly aggregate: {
    readonly graph: EvaluationMetrics;
    readonly directFileBaseline: EvaluationMetrics;
  };
}

export type EvaluationResource =
  | { readonly state: 'loading'; readonly data: null; readonly message: string }
  | { readonly state: 'ready'; readonly data: EvaluationResponse; readonly message: string }
  | { readonly state: 'error'; readonly data: null; readonly message: string };

export function useEvaluation(): {
  readonly resource: EvaluationResource;
  readonly refresh: () => void;
} {
  const [requestVersion, setRequestVersion] = useState(0);
  const [resource, setResource] = useState<EvaluationResource>({
    state: 'loading',
    data: null,
    message: 'Loading the verified evaluation artifact.',
  });

  useEffect(() => {
    const controller = new AbortController();
    setResource({
      state: 'loading',
      data: null,
      message: 'Loading the verified evaluation artifact.',
    });
    void fetch('/api/evaluation/latest', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const value = (await response.json()) as unknown;
        if (!response.ok) {
          throw new Error(
            unavailableMessage(value) ?? `Evaluation request failed with ${response.status}`,
          );
        }
        return parseEvaluationResponse(value);
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResource({ state: 'ready', data, message: 'Verified evaluation artifact loaded.' });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResource({
          state: 'error',
          data: null,
          message:
            error instanceof Error
              ? `Evaluation unavailable: ${error.message}`
              : 'Evaluation unavailable.',
        });
      });
    return () => controller.abort();
  }, [requestVersion]);

  const refresh = useCallback(() => setRequestVersion((current) => current + 1), []);
  return { resource, refresh };
}

export function parseEvaluationResponse(value: unknown): EvaluationResponse {
  const artifact = record(value, 'evaluation response');
  literal(artifact, 'status', 'ready');
  literal(artifact, 'source', 'verified_reference');
  literal(artifact, 'command', 'pnpm evaluate');
  literal(artifact, 'engine', 'HydraDB OSS v0.1.1');
  literal(artifact, 'traversalBoundary', 'zero to three reverse call hops');
  const datasetRecord = record(artifact['dataset'], 'evaluation dataset');
  literal(datasetRecord, 'status', 'complete');
  literal(datasetRecord, 'source', 'versioned real Git fixtures');
  const aggregateRecord = record(artifact['aggregate'], 'evaluation aggregate');
  return {
    status: 'ready',
    source: 'verified_reference',
    evaluationId: text(artifact, 'evaluationId'),
    completedAt: text(artifact, 'completedAt'),
    command: 'pnpm evaluate',
    engine: 'HydraDB OSS v0.1.1',
    traversalBoundary: 'zero to three reverse call hops',
    dataset: {
      status: 'complete',
      source: 'versioned real Git fixtures',
      caseCount: integer(datasetRecord, 'caseCount'),
      labelCount: integer(datasetRecord, 'labelCount'),
    },
    cases: array(artifact, 'cases').map(parseCase),
    aggregate: {
      graph: parseMetrics(aggregateRecord['graph']),
      directFileBaseline: parseMetrics(aggregateRecord['directFileBaseline']),
    },
  };
}

function parseCase(value: unknown): EvaluationCase {
  const entry = record(value, 'evaluation case');
  return {
    caseId: text(entry, 'caseId'),
    description: text(entry, 'description'),
    changeSummary: text(entry, 'changeSummary'),
    labelCount: integer(entry, 'labelCount'),
    changedSymbolCount: integer(entry, 'changedSymbolCount'),
    unresolvedCallCount: integer(entry, 'unresolvedCallCount'),
    labels: array(entry, 'labels').map(parseLabel),
    graph: parseMetrics(entry['graph']),
    directFileBaseline: parseMetrics(entry['directFileBaseline']),
  };
}

function parseLabel(value: unknown): EvaluationLabel {
  const label = record(value, 'evaluation label');
  const graph = record(label['graph'], 'graph result');
  const baseline = record(label['directFileBaseline'], 'baseline result');
  return {
    id: text(label, 'id'),
    claim: text(label, 'claim'),
    evidence: parseEvidence(label['evidence']),
    expectedAffected: boolean(label, 'expectedAffected'),
    graph: {
      affected: boolean(graph, 'affected'),
      classification: classification(graph, 'classification'),
      callHops: nullableInteger(graph['callHops']),
      actualPath: nullablePath(graph['actualPath']),
    },
    directFileBaseline: {
      affected: boolean(baseline, 'affected'),
      classification: classification(baseline, 'classification'),
    },
  };
}

function parseMetrics(value: unknown): EvaluationMetrics {
  const metrics = record(value, 'evaluation metrics');
  return {
    truePositives: integer(metrics, 'truePositives'),
    trueNegatives: integer(metrics, 'trueNegatives'),
    falsePositives: integer(metrics, 'falsePositives'),
    falseNegatives: integer(metrics, 'falseNegatives'),
    precision: nullableScore(metrics['precision']),
    recall: nullableScore(metrics['recall']),
    falsePositiveIds: stringArray(metrics['falsePositiveIds']),
    falseNegativeIds: stringArray(metrics['falseNegativeIds']),
  };
}

function parseEvidence(value: unknown): EvaluationEvidence {
  const evidence = record(value, 'evaluation evidence');
  return { path: text(evidence, 'path'), qualifiedName: text(evidence, 'qualifiedName') };
}

function unavailableMessage(value: unknown): string | null {
  if (
    !isRecord(value) ||
    value['status'] !== 'unavailable' ||
    typeof value['message'] !== 'string'
  ) {
    return null;
  }
  return value['message'];
}

function nullablePath(value: unknown): readonly EvaluationEvidence[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error('Invalid evaluation graph path');
  return value.map(parseEvidence);
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid evaluation integer');
  }
  return value;
}

function nullableScore(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid evaluation score');
  }
  return value;
}

function classification(
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
    throw new Error('Invalid evaluation classification');
  }
  return entry;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function array(value: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const entry = value[key];
  if (!Array.isArray(entry)) throw new Error(`Invalid ${key}`);
  return entry;
}

function text(value: Readonly<Record<string, unknown>>, key: string): string {
  const entry = value[key];
  if (typeof entry !== 'string' || entry.length === 0) throw new Error(`Invalid ${key}`);
  return entry;
}

function integer(value: Readonly<Record<string, unknown>>, key: string): number {
  const entry = value[key];
  if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) {
    throw new Error(`Invalid ${key}`);
  }
  return entry;
}

function boolean(value: Readonly<Record<string, unknown>>, key: string): boolean {
  const entry = value[key];
  if (typeof entry !== 'boolean') throw new Error(`Invalid ${key}`);
  return entry;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Invalid evaluation ids');
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new Error('Invalid evaluation ids');
    return entry;
  });
}

function literal(value: Readonly<Record<string, unknown>>, key: string, expected: string): void {
  if (value[key] !== expected) throw new Error(`Invalid ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
