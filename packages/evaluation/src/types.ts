import type { BinaryMetrics } from './metrics.js';

export interface EvaluationEvidence {
  readonly path: string;
  readonly qualifiedName: string;
}

export type EvaluationClassification =
  'true_positive' | 'true_negative' | 'false_positive' | 'false_negative';

export interface EvaluationPrediction {
  readonly affected: boolean;
  readonly classification: EvaluationClassification;
}

export interface EvaluationGraphPrediction extends EvaluationPrediction {
  readonly callHops: number | null;
  readonly actualPath: readonly EvaluationEvidence[] | null;
}

export interface EvaluationLabelResult {
  readonly id: string;
  readonly claim: string;
  readonly evidence: EvaluationEvidence;
  readonly expectedAffected: boolean;
  readonly expectedPath: readonly EvaluationEvidence[] | null;
  readonly graph: EvaluationGraphPrediction;
  readonly directFileBaseline: EvaluationPrediction;
}

export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly description: string;
  readonly changeSummary: string;
  readonly beforeCommit: string;
  readonly afterCommit: string;
  readonly labelCount: number;
  readonly changedSymbolCount: number;
  readonly unresolvedCallCount: number;
  readonly labels: readonly EvaluationLabelResult[];
  readonly graph: BinaryMetrics;
  readonly directFileBaseline: BinaryMetrics;
}

export interface EvaluationArtifact {
  readonly schemaVersion: 1;
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
  readonly cases: readonly EvaluationCaseResult[];
  readonly aggregate: {
    readonly graph: BinaryMetrics;
    readonly directFileBaseline: BinaryMetrics;
  };
}
