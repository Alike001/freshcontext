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

export interface PublicRepositoryProvenance {
  readonly kind: 'public_repository';
  readonly repository: string;
  readonly url: string;
  readonly beforeCommit: string;
  readonly afterCommit: string;
  readonly license: string;
  readonly sourcePaths: readonly string[];
}

export interface EvaluationMcpRecallResult {
  readonly status: 'ready';
  readonly indexedCommit: string;
  readonly returnedMemoryIds: readonly string[];
  readonly withheldMemoryIds: readonly string[];
  readonly abstained: boolean;
  readonly abstentionReason: 'no_memory' | 'all_matching_memory_unsafe' | null;
}

export interface EvaluationMcpReceipt {
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
  readonly beforeChange: EvaluationMcpRecallResult;
  readonly afterChange: EvaluationMcpRecallResult;
}

export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly description: string;
  readonly changeSummary: string;
  readonly provenance: PublicRepositoryProvenance | null;
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
  readonly mcpReceipt: EvaluationMcpReceipt;
  readonly aggregate: {
    readonly graph: BinaryMetrics;
    readonly directFileBaseline: BinaryMetrics;
  };
}
