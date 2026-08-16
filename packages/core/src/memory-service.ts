import { createHash } from 'node:crypto';

import {
  canonicalJson,
  createImmutableEntity,
  createImmutableRelationship,
  deterministicIntegerId,
  entityKeys,
  type HydraQueryGateway,
  type ImmutableEntity,
  type ImmutableGraphStore,
  type StoredEntity,
} from '@freshcontext/graph';
import { HydraRequestError, type HydraQueryResponse } from '@freshcontext/hydra';

import { ContextUnavailableError, MemoryDomainError } from './errors.js';
import {
  immutableEntityFromStored,
  numberProperties,
  parseEntityPayload,
  requiredStringProperty,
} from './payload.js';
import {
  INSPECT_MEMORY_STATE_QUERY,
  INSPECT_REPOSITORY_SYNC_QUERY,
  LIST_INDEX_RUNS_QUERY,
  RECALL_MEMORIES_QUERY,
  RESOLVE_STABLE_SYMBOL_QUERY,
  SET_MEMORY_STATE_QUERY,
} from './queries.js';
import {
  MEMORY_STATES,
  type ContextUnavailableResult,
  type EvidenceReference,
  type MemoryRecord,
  type MemoryState,
  type RecallInput,
  type RecallResult,
  type RememberInput,
  type RepositoryStatusResult,
  type SafeRecallResult,
  type SafeStatusResult,
  type StatusInput,
} from './types.js';

const MAX_CLAIM_LENGTH = 2_000;
const MAX_EVIDENCE_COUNT = 10;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;

export interface MemoryServiceOptions {
  readonly graph: ImmutableGraphStore;
  readonly hydra: HydraQueryGateway;
  readonly clock?: () => Date;
}

export class MemoryService {
  readonly #graph: ImmutableGraphStore;
  readonly #hydra: HydraQueryGateway;
  readonly #clock: () => Date;

  public constructor(options: MemoryServiceOptions) {
    this.#graph = options.graph;
    this.#hydra = options.hydra;
    this.#clock = options.clock ?? (() => new Date());
  }

  public async remember(input: RememberInput): Promise<MemoryRecord> {
    const normalized = normalizeRememberInput(input);
    await this.#requireCompletedIndex(normalized.repositoryId, normalized.commitSha);
    const evidence = await Promise.all(
      normalized.evidence.map((reference) =>
        this.#requireEvidence(normalized.repositoryId, normalized.commitSha, reference),
      ),
    );
    const memoryId = memoryPublicId(normalized);
    const memoryKey = entityKeys.memory(normalized.repositoryId, memoryId);
    const existing = await this.#graph.inspectEntity(deterministicIntegerId('entity', memoryKey));
    const existingState = existing ? await this.#inspectMemoryState(existing.id) : undefined;
    if (existingState && existingState !== 'pending' && existingState !== 'current') {
      throw new MemoryDomainError(
        'MEMORY_NOT_RETRYABLE',
        `Memory ${memoryId} is ${existingState} and cannot be reactivated by remember`,
      );
    }
    const createdAt = existing
      ? requiredStringProperty(parseEntityPayload(existing), 'createdAt')
      : this.#clock().toISOString();
    const memory = createImmutableEntity('Memory', memoryKey, {
      memoryId,
      repositoryId: normalized.repositoryId,
      sourceCommit: normalized.commitSha,
      claim: normalized.claim,
      createdAt,
      evidence: normalized.evidence.map((reference) => ({
        path: reference.path,
        qualifiedName: reference.qualifiedName,
      })),
    });

    const firstEvidence = evidence[0];
    if (!firstEvidence) {
      throw new MemoryDomainError('INVALID_INPUT', 'At least one evidence reference is required');
    }
    await this.#graph.writeRelationship(
      createImmutableRelationship('SUPPORTED_BY', memory, firstEvidence),
    );
    if (existingState !== 'current') {
      await this.#setMemoryState(memory.id, 'pending');
    }
    for (const target of evidence.slice(1)) {
      await this.#graph.writeRelationship(
        createImmutableRelationship('SUPPORTED_BY', memory, target),
      );
    }
    const event = createImmutableEntity(
      'MemoryEvent',
      entityKeys.memoryEvent(normalized.repositoryId, memoryId, 'created'),
      {
        memoryId,
        eventType: 'created',
        state: 'current',
        commitSha: normalized.commitSha,
        occurredAt: createdAt,
      },
    );
    await this.#graph.writeRelationship(createImmutableRelationship('HAS_EVENT', memory, event));
    await this.#setMemoryState(memory.id, 'current');
    return memoryRecord(memory, 'current');
  }

  public async recall(input: RecallInput): Promise<SafeRecallResult> {
    try {
      const context = normalizeEvidence({ path: input.path, qualifiedName: input.qualifiedName });
      validateRepositoryAndCommit(input.repositoryId, input.commitSha);
      await this.#requireCompletedIndex(input.repositoryId, input.commitSha);
      const evidence = await this.#requireEvidence(input.repositoryId, input.commitSha, context);
      const symbolId = await this.#requireStableSymbolId(evidence.id);
      const response = await this.#hydra.query(RECALL_MEMORIES_QUERY, {
        parameters: { symbolId },
        consistency: 'strong',
      });
      const active: MemoryRecord[] = [];
      const withheld: string[] = [];
      for (let row = 0; row < response.rows.length; row += 1) {
        const stored = storedMemoryFromRow(response, row);
        const state = memoryStateFromCell(response, row, 'state') ?? 'pending';
        const record = memoryRecord(immutableEntityFromStored(stored), state);
        if (state === 'current') {
          active.push(record);
        } else {
          withheld.push(record.memoryId);
        }
      }
      const result: RecallResult = {
        status: 'ready',
        repositoryId: input.repositoryId,
        indexedCommit: input.commitSha,
        context,
        memories: active.sort((left, right) => left.memoryId.localeCompare(right.memoryId, 'en')),
        withheldCount: withheld.length,
        withheldMemoryIds: withheld.sort((left, right) => left.localeCompare(right, 'en')),
        abstained: active.length === 0,
        abstentionReason:
          active.length > 0
            ? null
            : withheld.length > 0
              ? 'all_matching_memory_unsafe'
              : 'no_memory',
      };
      return result;
    } catch (error) {
      if (error instanceof HydraRequestError) return contextUnavailable();
      if (error instanceof ContextUnavailableError) return contextUnavailable(error.message);
      throw error;
    }
  }

  public async status(input: StatusInput): Promise<SafeStatusResult> {
    try {
      validateNonEmpty('repositoryId', input.repositoryId, 200);
      const repository = await this.#repositorySyncState(input.repositoryId);
      if (repository.syncState === 'syncing') throw new ContextUnavailableError();
      const runs = await this.#listIndexRuns(input.repositoryId);
      const selected = repository.selectedCommit
        ? runs.find((run) => run.commitSha === repository.selectedCommit)
        : runs[0];
      if (repository.selectedCommit && !selected) {
        throw new MemoryDomainError(
          'CORRUPT_GRAPH',
          `Selected commit ${repository.selectedCommit} has no completed index run`,
        );
      }
      const result: RepositoryStatusResult = {
        status: 'ready',
        repositoryId: input.repositoryId,
        indexed: selected !== undefined,
        indexedCommit: selected?.commitSha ?? null,
        statistics: selected?.statistics ?? null,
      };
      return result;
    } catch (error) {
      if (error instanceof HydraRequestError) return contextUnavailable();
      if (error instanceof ContextUnavailableError) return contextUnavailable(error.message);
      throw error;
    }
  }

  public async setMemoryState(memoryId: number, state: MemoryState): Promise<void> {
    await this.#setMemoryState(memoryId, state);
  }

  async #requireCompletedIndex(repositoryId: string, commitSha: string): Promise<StoredEntity> {
    validateRepositoryAndCommit(repositoryId, commitSha);
    const repository = await this.#repositorySyncState(repositoryId);
    if (repository.syncState === 'syncing') throw new ContextUnavailableError();
    const runs = await this.#listIndexRuns(repositoryId);
    const selected = repository.selectedCommit
      ? runs.find((run) => run.commitSha === repository.selectedCommit)
      : runs[0];
    if (!selected) {
      throw new MemoryDomainError(
        'INDEX_NOT_FOUND',
        `Repository ${repositoryId} has no completed FreshContext index run`,
      );
    }
    if (selected.commitSha !== commitSha) {
      throw new MemoryDomainError(
        'STALE_COMMIT',
        `Commit ${commitSha} is stale. The selected index is ${selected.commitSha}`,
      );
    }
    const key = entityKeys.indexRun(repositoryId, commitSha);
    const stored = await this.#graph.inspectEntity(deterministicIntegerId('entity', key));
    if (!stored) {
      throw new MemoryDomainError(
        'INDEX_NOT_FOUND',
        `Commit ${commitSha} has no completed FreshContext index run`,
      );
    }
    const payload = parseEntityPayload(stored);
    if (payload.kind !== 'IndexRun' || requiredStringProperty(payload, 'state') !== 'complete') {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Index run ${key} is not complete`);
    }
    return stored;
  }

  async #requireEvidence(
    repositoryId: string,
    commitSha: string,
    reference: EvidenceReference,
  ): Promise<ImmutableEntity> {
    const key = entityKeys.symbolRevision(
      repositoryId,
      commitSha,
      reference.path,
      reference.qualifiedName,
    );
    const stored = await this.#graph.inspectEntity(deterministicIntegerId('entity', key));
    if (!stored) {
      throw new MemoryDomainError(
        'EVIDENCE_NOT_FOUND',
        `Evidence ${reference.path}::${reference.qualifiedName} is not indexed at ${commitSha}`,
      );
    }
    const payload = parseEntityPayload(stored);
    if (
      payload.kind !== 'SymbolRevision' ||
      requiredStringProperty(payload, 'commitSha') !== commitSha ||
      requiredStringProperty(payload, 'path') !== reference.path ||
      requiredStringProperty(payload, 'qualifiedName') !== reference.qualifiedName
    ) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Evidence entity ${key} does not match`);
    }
    return immutableEntityFromStored(stored);
  }

  async #setMemoryState(memoryId: number, state: MemoryState): Promise<void> {
    if (!MEMORY_STATES.includes(state)) {
      throw new MemoryDomainError('INVALID_INPUT', `Unsupported memory state ${state}`);
    }
    const currentState = await this.#inspectMemoryState(memoryId);
    if (currentState === state) return;
    await this.#hydra.query(SET_MEMORY_STATE_QUERY, {
      parameters: { memoryId, state },
      queryId: `freshcontext-memory-state-v1-${memoryId}-${currentState ?? 'unset'}-to-${state}`,
    });
    const stored = await this.#inspectMemoryState(memoryId);
    if (stored !== state) {
      throw new HydraRequestError(`HydraDB did not persist memory state ${state}`, {});
    }
  }

  async #requireStableSymbolId(evidenceId: number): Promise<number> {
    const response = await this.#hydra.query(RESOLVE_STABLE_SYMBOL_QUERY, {
      parameters: { evidenceId },
      consistency: 'strong',
    });
    if (response.rows.length !== 1) {
      throw new MemoryDomainError(
        'CORRUPT_GRAPH',
        `Evidence ${evidenceId} has ${response.rows.length} stable symbol identities`,
      );
    }
    return requiredNumberCell(response, 0, 'symbolId');
  }

  async #inspectMemoryState(memoryId: number): Promise<MemoryState | undefined> {
    const response = await this.#hydra.query(INSPECT_MEMORY_STATE_QUERY, {
      parameters: { memoryId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) return undefined;
    if (response.rows.length !== 1) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Memory id ${memoryId} is duplicated`);
    }
    return memoryStateFromCell(response, 0, 'state');
  }

  async #listIndexRuns(repositoryId: string): Promise<IndexRunRecord[]> {
    validateNonEmpty('repositoryId', repositoryId, 200);
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    const response = await this.#hydra.query(LIST_INDEX_RUNS_QUERY, {
      parameters: { repositoryId: repositoryVertexId },
      consistency: 'strong',
    });
    const runs = response.rows.map((_, row) => indexRunFromRow(response, row));
    return runs.sort(
      (left, right) =>
        Date.parse(right.committedAt) - Date.parse(left.committedAt) ||
        right.commitSha.localeCompare(left.commitSha, 'en'),
    );
  }

  async #repositorySyncState(repositoryId: string): Promise<RepositorySyncState> {
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    const response = await this.#hydra.query(INSPECT_REPOSITORY_SYNC_QUERY, {
      parameters: { repositoryId: repositoryVertexId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) return { selectedCommit: null, syncState: 'ready' };
    if (response.rows.length !== 1) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Repository ${repositoryId} is duplicated`);
    }
    const selectedCommit = optionalStringCell(response, 0, 'selectedCommit');
    const syncState = optionalStringCell(response, 0, 'syncState') ?? 'ready';
    if (syncState !== 'ready' && syncState !== 'syncing') {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Repository ${repositoryId} state is invalid`);
    }
    return { selectedCommit: selectedCommit ?? null, syncState };
  }
}

function normalizeRememberInput(input: RememberInput): RememberInput {
  validateRepositoryAndCommit(input.repositoryId, input.commitSha);
  validateNonEmpty('claim', input.claim, MAX_CLAIM_LENGTH);
  if (input.evidence.length === 0 || input.evidence.length > MAX_EVIDENCE_COUNT) {
    throw new MemoryDomainError(
      'INVALID_INPUT',
      `evidence must contain between 1 and ${MAX_EVIDENCE_COUNT} references`,
    );
  }
  const evidence = input.evidence.map(normalizeEvidence);
  const unique = new Map(evidence.map((item) => [`${item.path}\0${item.qualifiedName}`, item]));
  if (unique.size !== evidence.length) {
    throw new MemoryDomainError('INVALID_INPUT', 'evidence references must be unique');
  }
  return {
    repositoryId: input.repositoryId,
    commitSha: input.commitSha,
    claim: input.claim,
    evidence: [...unique.values()].sort((left, right) =>
      `${left.path}\0${left.qualifiedName}`.localeCompare(
        `${right.path}\0${right.qualifiedName}`,
        'en',
      ),
    ),
  };
}

function normalizeEvidence(reference: EvidenceReference): EvidenceReference {
  validateNonEmpty('path', reference.path, 1_000);
  validateNonEmpty('qualifiedName', reference.qualifiedName, 500);
  if (reference.path.startsWith('/') || reference.path.split('/').includes('..')) {
    throw new MemoryDomainError('INVALID_INPUT', 'evidence path must be repository-relative');
  }
  return { path: reference.path, qualifiedName: reference.qualifiedName };
}

function validateRepositoryAndCommit(repositoryId: string, commitSha: string): void {
  validateNonEmpty('repositoryId', repositoryId, 200);
  if (!COMMIT_SHA.test(commitSha)) {
    throw new MemoryDomainError('INVALID_INPUT', 'commitSha must be a full Git object id');
  }
}

function validateNonEmpty(name: string, value: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw new MemoryDomainError(
      'INVALID_INPUT',
      `${name} must be a trimmed printable value of at most ${maxLength} characters`,
    );
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function memoryPublicId(input: RememberInput): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        repositoryId: input.repositoryId,
        commitSha: input.commitSha,
        claim: input.claim,
        evidence: input.evidence.map((reference) => ({
          path: reference.path,
          qualifiedName: reference.qualifiedName,
        })),
      }),
      'utf8',
    )
    .digest('hex')
    .slice(0, 32);
}

function memoryRecord(entity: ImmutableEntity, state: MemoryState): MemoryRecord {
  const payload = parseEntityPayload({
    id: entity.id,
    entityKey: entity.entityKey,
    kind: entity.kind,
    payloadHash: entity.payloadHash,
    payload: entity.payload,
  });
  const evidence = payload.properties['evidence'];
  if (!Array.isArray(evidence)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Memory ${entity.entityKey} has no evidence`);
  }
  return {
    memoryId: requiredStringProperty(payload, 'memoryId'),
    claim: requiredStringProperty(payload, 'claim'),
    repositoryId: requiredStringProperty(payload, 'repositoryId'),
    sourceCommit: requiredStringProperty(payload, 'sourceCommit'),
    createdAt: requiredStringProperty(payload, 'createdAt'),
    state,
    evidence: evidence.map(parseEvidence),
  };
}

function parseEvidence(value: unknown): EvidenceReference {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('path' in value) ||
    !('qualifiedName' in value) ||
    typeof value.path !== 'string' ||
    typeof value.qualifiedName !== 'string'
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory evidence is invalid');
  }
  return { path: value.path, qualifiedName: value.qualifiedName };
}

function storedMemoryFromRow(response: HydraQueryResponse, row: number): StoredEntity {
  return {
    id: requiredNumberCell(response, row, 'memoryId'),
    entityKey: requiredStringCell(response, row, 'entityKey'),
    kind: requiredEntityKindCell(response, row, 'entityKind', 'Memory'),
    payloadHash: requiredStringCell(response, row, 'payloadHash'),
    payload: requiredStringCell(response, row, 'payload'),
  };
}

function memoryStateFromCell(
  response: HydraQueryResponse,
  row: number,
  column: string,
): MemoryState | undefined {
  const cell = requiredCell(response, row, column);
  if (cell.type === 'null') return undefined;
  if (cell.type !== 'string' || !MEMORY_STATES.includes(cell.value as MemoryState)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Memory state is invalid`);
  }
  return cell.value as MemoryState;
}

function indexRunFromRow(response: HydraQueryResponse, row: number): IndexRunRecord {
  const stored: StoredEntity = {
    id: requiredNumberCell(response, row, 'runId'),
    entityKey: requiredStringCell(response, row, 'entityKey'),
    kind: requiredEntityKindCell(response, row, 'entityKind', 'IndexRun'),
    payloadHash: requiredStringCell(response, row, 'payloadHash'),
    payload: requiredStringCell(response, row, 'payload'),
  };
  const payload = parseEntityPayload(stored);
  const committedAt = requiredStringProperty(payload, 'committedAt');
  if (Number.isNaN(Date.parse(committedAt))) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Index run ${stored.entityKey} has invalid time`);
  }
  return {
    commitSha: requiredStringProperty(payload, 'commitSha'),
    committedAt,
    statistics: numberProperties(payload, 'statistics'),
  };
}

interface IndexRunRecord {
  readonly commitSha: string;
  readonly committedAt: string;
  readonly statistics: Record<string, number>;
}

interface RepositorySyncState {
  readonly selectedCommit: string | null;
  readonly syncState: 'ready' | 'syncing';
}

function requiredEntityKindCell<T extends StoredEntity['kind']>(
  response: HydraQueryResponse,
  row: number,
  column: string,
  expected: T,
): T {
  const value = requiredStringCell(response, row, column);
  if (value !== expected) {
    throw new MemoryDomainError(
      'CORRUPT_GRAPH',
      `HydraDB column ${column} is ${value}, expected ${expected}`,
    );
  }
  return expected;
}

function requiredStringCell(response: HydraQueryResponse, row: number, column: string): string {
  const value = requiredCell(response, row, column);
  if (value.type !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not a string`);
  }
  return value.value;
}

function requiredNumberCell(response: HydraQueryResponse, row: number, column: string): number {
  const value = requiredCell(response, row, column);
  if (
    (value.type !== 'integer' && value.type !== 'signed_integer' && value.type !== 'vertex_id') ||
    !Number.isSafeInteger(value.value)
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not an integer`);
  }
  return value.value;
}

function optionalStringCell(
  response: HydraQueryResponse,
  row: number,
  column: string,
): string | undefined {
  const value = requiredCell(response, row, column);
  if (value.type === 'null') return undefined;
  if (value.type !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not a string`);
  }
  return value.value;
}

function requiredCell(response: HydraQueryResponse, row: number, column: string) {
  const index = response.columns.indexOf(column);
  const value = index >= 0 ? response.rows[row]?.[index] : undefined;
  if (!value) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB omitted column ${column}`);
  }
  return value;
}

function contextUnavailable(
  message = 'HydraDB is unavailable, so FreshContext cannot verify memory safety',
): ContextUnavailableResult {
  return {
    status: 'context_unavailable',
    message,
  };
}
