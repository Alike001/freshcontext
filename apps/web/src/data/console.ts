export type MemoryState = 'pending' | 'current' | 'needs_review' | 'superseded';

export interface EvidenceReference {
  readonly path: string;
  readonly qualifiedName: string;
}

export interface ConsoleMemory {
  readonly memoryId: string;
  readonly claim: string;
  readonly state: MemoryState;
  readonly sourceCommit: string;
  readonly createdAt: string;
  readonly evidence: readonly EvidenceReference[];
}

export interface ConsoleStep {
  readonly position: number;
  readonly nodeKind: 'SymbolRevision' | 'Memory';
  readonly relationshipFromPrevious: 'CALLS_REVERSE' | 'SUPPORTED_BY_REVERSE' | null;
  readonly path: string | null;
  readonly qualifiedName: string | null;
  readonly memoryId: string | null;
  readonly claim: string | null;
}

export interface ConsoleEvent {
  readonly eventType: 'created' | 'invalidated' | 'superseded' | 'reviewed-replacement';
  readonly state: MemoryState;
  readonly commitSha: string;
  readonly occurredAt: string;
}

export interface ConsoleResponse {
  readonly status: 'ready';
  readonly source: 'example' | 'configured';
  readonly repositoryId: string;
  readonly repositoryLabel: string;
  readonly selectedCommit: string;
  readonly memories: readonly ConsoleMemory[];
  readonly selected: {
    readonly memory: ConsoleMemory;
    readonly impact: {
      readonly callHops: number;
      readonly pathSignature: string;
      readonly change: {
        readonly symbolKey: string;
        readonly changeKind: 'added' | 'changed' | 'removed';
        readonly fromCommit: string;
        readonly toCommit: string;
        readonly beforeSourceHash: string | null;
        readonly afterSourceHash: string | null;
      };
      readonly steps: readonly ConsoleStep[];
    } | null;
    readonly chronology: readonly ConsoleEvent[];
    readonly replacement: ConsoleMemory | null;
    readonly original: ConsoleMemory | null;
    readonly diff: string | null;
  } | null;
}

export async function fetchConsole(
  memoryId?: string,
  signal?: AbortSignal,
): Promise<ConsoleResponse> {
  const query = memoryId ? `?memoryId=${encodeURIComponent(memoryId)}` : '';
  const response = await fetch(`/api/console${query}`, {
    ...(signal ? { signal } : {}),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Proof Console request failed with ${response.status}`);
  return parseConsoleResponse(await response.json());
}

export async function reviewMemory(
  memoryId: string,
  replacementClaim: string,
): Promise<ConsoleResponse> {
  const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}/review`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ replacementClaim }),
  });
  if (!response.ok) throw new Error(`Review request failed with ${response.status}`);
  return parseConsoleResponse(await response.json());
}

export function parseConsoleResponse(value: unknown): ConsoleResponse {
  const root = record(value, 'console response');
  if (root['status'] !== 'ready') throw new Error('Invalid console status');
  const source = root['source'];
  if (source !== 'example' && source !== 'configured') throw new Error('Invalid console source');
  const memoriesValue = root['memories'];
  if (!Array.isArray(memoriesValue)) throw new Error('Invalid console memories');
  const selectedValue = root['selected'];
  return {
    status: 'ready',
    source,
    repositoryId: string(root['repositoryId']),
    repositoryLabel: string(root['repositoryLabel']),
    selectedCommit: commit(root['selectedCommit']),
    memories: memoriesValue.map(memory),
    selected: selectedValue === null ? null : dossier(selectedValue),
  };
}

function dossier(value: unknown): NonNullable<ConsoleResponse['selected']> {
  const entry = record(value, 'console dossier');
  const chronology = entry['chronology'];
  if (!Array.isArray(chronology)) throw new Error('Invalid console chronology');
  const impactValue = entry['impact'];
  return {
    memory: memory(entry['memory']),
    impact: impactValue === null ? null : impact(impactValue),
    chronology: chronology.map(event),
    replacement: entry['replacement'] === null ? null : memory(entry['replacement']),
    original: entry['original'] === null ? null : memory(entry['original']),
    diff: nullableString(entry['diff']),
  };
}

function memory(value: unknown): ConsoleMemory {
  const entry = record(value, 'memory');
  const evidence = entry['evidence'];
  if (!Array.isArray(evidence)) throw new Error('Invalid memory evidence');
  return {
    memoryId: string(entry['memoryId']),
    claim: string(entry['claim']),
    state: memoryState(entry['state']),
    sourceCommit: commit(entry['sourceCommit']),
    createdAt: date(entry['createdAt']),
    evidence: evidence.map((item) => {
      const reference = record(item, 'evidence');
      return { path: string(reference['path']), qualifiedName: string(reference['qualifiedName']) };
    }),
  };
}

function impact(value: unknown): NonNullable<NonNullable<ConsoleResponse['selected']>['impact']> {
  const entry = record(value, 'impact');
  const change = record(entry['change'], 'change');
  const steps = entry['steps'];
  if (!Array.isArray(steps)) throw new Error('Invalid impact steps');
  const changeKind = change['changeKind'];
  if (changeKind !== 'added' && changeKind !== 'changed' && changeKind !== 'removed') {
    throw new Error('Invalid change kind');
  }
  return {
    callHops: nonNegativeInteger(entry['callHops']),
    pathSignature: string(entry['pathSignature']),
    change: {
      symbolKey: string(change['symbolKey']),
      changeKind,
      fromCommit: commit(change['fromCommit']),
      toCommit: commit(change['toCommit']),
      beforeSourceHash: nullableString(change['beforeSourceHash']),
      afterSourceHash: nullableString(change['afterSourceHash']),
    },
    steps: steps.map(step),
  };
}

function step(value: unknown): ConsoleStep {
  const entry = record(value, 'impact step');
  const nodeKind = entry['nodeKind'];
  const relationship = entry['relationshipFromPrevious'];
  if (nodeKind !== 'SymbolRevision' && nodeKind !== 'Memory') throw new Error('Invalid step kind');
  if (
    relationship !== null &&
    relationship !== 'CALLS_REVERSE' &&
    relationship !== 'SUPPORTED_BY_REVERSE'
  ) {
    throw new Error('Invalid step relationship');
  }
  return {
    position: nonNegativeInteger(entry['position']),
    nodeKind,
    relationshipFromPrevious: relationship,
    path: nullableString(entry['path']),
    qualifiedName: nullableString(entry['qualifiedName']),
    memoryId: nullableString(entry['memoryId']),
    claim: nullableString(entry['claim']),
  };
}

function event(value: unknown): ConsoleEvent {
  const entry = record(value, 'event');
  const eventType = entry['eventType'];
  if (
    eventType !== 'created' &&
    eventType !== 'invalidated' &&
    eventType !== 'superseded' &&
    eventType !== 'reviewed-replacement'
  ) {
    throw new Error('Invalid event type');
  }
  return {
    eventType,
    state: memoryState(entry['state']),
    commitSha: commit(entry['commitSha']),
    occurredAt: date(entry['occurredAt']),
  };
}

function memoryState(value: unknown): MemoryState {
  if (
    value !== 'pending' &&
    value !== 'current' &&
    value !== 'needs_review' &&
    value !== 'superseded'
  ) {
    throw new Error('Invalid memory state');
  }
  return value;
}

function commit(value: unknown): string {
  const result = string(value);
  if (!/^[a-f0-9]{40,64}$/u.test(result)) throw new Error('Invalid commit');
  return result;
}

function date(value: unknown): string {
  const result = string(value);
  if (Number.isNaN(Date.parse(result))) throw new Error('Invalid date');
  return result;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid integer');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value as Record<string, unknown>;
}
