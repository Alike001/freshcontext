import type { EvidenceReference, MemoryState } from './types.js';

export interface ConsoleMemorySummary {
  readonly memoryId: string;
  readonly claim: string;
  readonly state: MemoryState;
  readonly sourceCommit: string;
  readonly createdAt: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface ConsoleImpactChange {
  readonly symbolKey: string;
  readonly changeKind: 'added' | 'changed' | 'removed';
  readonly fromCommit: string;
  readonly toCommit: string;
  readonly beforeSourceHash: string | null;
  readonly afterSourceHash: string | null;
}

export interface ConsoleImpactStep {
  readonly position: number;
  readonly nodeKind: 'SymbolRevision' | 'Memory';
  readonly relationshipFromPrevious: 'CALLS_REVERSE' | 'SUPPORTED_BY_REVERSE' | null;
  readonly path: string | null;
  readonly qualifiedName: string | null;
  readonly memoryId: string | null;
  readonly claim: string | null;
}

export interface ConsoleImpact {
  readonly callHops: number;
  readonly pathSignature: string;
  readonly change: ConsoleImpactChange;
  readonly steps: readonly ConsoleImpactStep[];
}

export interface ConsoleMemoryEvent {
  readonly eventType: 'created' | 'invalidated' | 'superseded' | 'reviewed-replacement';
  readonly state: MemoryState;
  readonly commitSha: string;
  readonly occurredAt: string;
}

export interface ConsoleDossier {
  readonly memory: ConsoleMemorySummary;
  readonly impact: ConsoleImpact | null;
  readonly chronology: readonly ConsoleMemoryEvent[];
  readonly replacement: ConsoleMemorySummary | null;
  readonly original: ConsoleMemorySummary | null;
}

export interface ConsoleReadResult {
  readonly repositoryId: string;
  readonly selectedCommit: string;
  readonly memories: readonly ConsoleMemorySummary[];
  readonly selected: ConsoleDossier | null;
}

export interface ReadConsoleInput {
  readonly repositoryId: string;
  readonly selectedCommit: string;
  readonly memoryId?: string;
}
