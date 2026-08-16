import {
  createImmutableEntity,
  createImmutableRelationship,
  deterministicIntegerId,
  entityKeys,
  type HydraQueryGateway,
  type ImmutableEntity,
  type ImmutableGraphStore,
  type StoredEntity,
} from '@freshcontext/graph';
import type { HydraQueryResponse } from '@freshcontext/hydra';
import {
  buildRepositorySnapshot,
  classifySymbolChanges,
  createSymbolRevisionEntity,
  indexRepository,
  inspectRepository,
  type RepositorySnapshot,
  type SymbolChange,
  type SymbolSnapshot,
} from '@freshcontext/indexer';

import { MemoryDomainError } from './errors.js';
import { MemoryService } from './memory-service.js';
import {
  immutableEntityFromStored,
  parseEntityPayload,
  requiredStringProperty,
} from './payload.js';
import {
  INSPECT_REPOSITORY_SYNC_QUERY,
  INSPECT_SYNC_STATE_QUERY,
  LIST_INDEX_RUNS_QUERY,
  LIST_SYMBOL_REVISIONS_QUERY,
  LIST_SYNC_RUNS_QUERY,
  SET_SYNC_STATE_QUERY,
  impactQuery,
  setRepositoryFieldQuery,
} from './queries.js';
import type {
  SynchronizeRepositoryInput,
  SynchronizeRepositoryResult,
  SyncCheckpoint,
} from './sync-types.js';
import { MEMORY_STATES, type MemoryState } from './types.js';

const MAX_CALL_HOPS = 3;

export interface SyncServiceOptions {
  readonly graph: ImmutableGraphStore;
  readonly hydra: HydraQueryGateway;
  readonly memory?: MemoryService;
  readonly faultInjector?: (checkpoint: SyncCheckpoint) => void | Promise<void>;
}

interface RepositoryState {
  readonly selectedCommit: string | null;
  readonly syncState: 'ready' | 'syncing';
  readonly pendingCommit: string | null;
}

interface IndexRunRecord {
  readonly commitSha: string;
  readonly committedAt: string;
}

interface StoredSymbol {
  readonly snapshot: SymbolSnapshot;
  readonly entity: ImmutableEntity;
}

interface ImpactCandidate {
  readonly memory: ImmutableEntity;
  readonly memoryId: string;
  readonly state: 'current' | 'needs_review';
  readonly changeKey: string;
  readonly callHops: number;
  readonly path: readonly ImmutableEntity[];
  readonly pathSignature: string;
}

interface StoredSyncRun {
  readonly entity: ImmutableEntity;
  readonly state: 'pending' | 'complete';
  readonly result: SynchronizeRepositoryResult;
}

export class SyncService {
  readonly #graph: ImmutableGraphStore;
  readonly #hydra: HydraQueryGateway;
  readonly #memory: MemoryService;
  readonly #faultInjector?: SyncServiceOptions['faultInjector'];

  public constructor(options: SyncServiceOptions) {
    this.#graph = options.graph;
    this.#hydra = options.hydra;
    this.#memory =
      options.memory ?? new MemoryService({ graph: options.graph, hydra: options.hydra });
    this.#faultInjector = options.faultInjector;
  }

  public async synchronize(
    input: SynchronizeRepositoryInput,
  ): Promise<SynchronizeRepositoryResult> {
    const descriptor = await inspectRepository(input.repositoryPath);
    const nextSnapshot = buildRepositorySnapshot(input.repositoryId, descriptor);
    const repositoryState = await this.#repositoryState(input.repositoryId);
    if (
      repositoryState.syncState === 'syncing' &&
      repositoryState.pendingCommit !== null &&
      repositoryState.pendingCommit !== nextSnapshot.commit.sha
    ) {
      throw new MemoryDomainError(
        'SYNC_CONFLICT',
        `Repository ${input.repositoryId} is already synchronizing ${repositoryState.pendingCommit}`,
      );
    }
    const indexRuns = await this.#indexRuns(input.repositoryId);
    const fallbackSelected = indexRuns[0]?.commitSha;
    let fromCommit = repositoryState.selectedCommit ?? fallbackSelected;
    if (!fromCommit) {
      throw new MemoryDomainError(
        'INDEX_NOT_FOUND',
        `Repository ${input.repositoryId} has no completed FreshContext index run`,
      );
    }

    const existingRuns = await this.#syncRuns(input.repositoryId);
    const matchingRun = existingRuns.find((run) => run.result.toCommit === nextSnapshot.commit.sha);
    if (fromCommit === nextSnapshot.commit.sha) {
      if (matchingRun?.state === 'complete') return { ...matchingRun.result, reused: true };
      if (!matchingRun) {
        return {
          repositoryId: input.repositoryId,
          fromCommit,
          toCommit: nextSnapshot.commit.sha,
          changeCount: 0,
          impactedMemoryIds: [],
          reused: true,
        };
      }
      fromCommit = matchingRun.result.fromCommit;
    }

    const operationKey = entityKeys.syncRun(
      input.repositoryId,
      fromCommit,
      nextSnapshot.commit.sha,
    );
    if (!repositoryState.selectedCommit) {
      await this.#setRepositoryField(
        input.repositoryId,
        'selected_commit',
        fromCommit,
        operationKey,
      );
    }
    await this.#setRepositoryField(input.repositoryId, 'sync_state', 'syncing', operationKey);
    await this.#setRepositoryField(
      input.repositoryId,
      'pending_commit',
      nextSnapshot.commit.sha,
      operationKey,
    );
    await this.#checkpoint('locked');

    await indexRepository({
      repositoryId: input.repositoryId,
      repositoryPath: input.repositoryPath,
      graph: this.#graph,
    });
    await this.#checkpoint('indexed');

    const previousSymbols = await this.#symbolsAtCommit(input.repositoryId, fromCommit);
    const changes = classifySymbolChanges(
      [...previousSymbols.values()].map((symbol) => symbol.snapshot),
      nextSnapshot.symbols,
    );
    const candidates = await this.#impactCandidates(changes, previousSymbols);
    const impactedMemoryIds = [...candidates.values()]
      .map((candidate) => candidate.memoryId)
      .sort(compareText);
    const result: SynchronizeRepositoryResult = {
      repositoryId: input.repositoryId,
      fromCommit,
      toCommit: nextSnapshot.commit.sha,
      changeCount: changes.length,
      impactedMemoryIds,
      reused: false,
    };
    const repository = createImmutableEntity(
      'Repository',
      entityKeys.repository(input.repositoryId),
      { repositoryId: input.repositoryId },
    );
    const sync = createImmutableEntity('SyncRun', operationKey, {
      repositoryId: input.repositoryId,
      fromCommit,
      toCommit: nextSnapshot.commit.sha,
      occurredAt: nextSnapshot.commit.committedAt,
      changeCount: changes.length,
      impactedMemoryIds,
      maxCallHops: MAX_CALL_HOPS,
    });
    await this.#graph.writeRelationship(
      createImmutableRelationship('HAS_SYNC_RUN', repository, sync),
    );
    await this.#setSyncState(sync.id, 'pending');
    const changeEntities = await this.#persistChanges(sync, changes, previousSymbols, nextSnapshot);
    await this.#persistImpacts(input.repositoryId, sync, candidates, changeEntities, nextSnapshot);
    await this.#checkpoint('proofs-persisted');

    await this.#setRepositoryField(
      input.repositoryId,
      'selected_commit',
      nextSnapshot.commit.sha,
      operationKey,
    );
    await this.#setRepositoryField(input.repositoryId, 'pending_commit', '', operationKey);
    await this.#setRepositoryField(input.repositoryId, 'sync_state', 'ready', operationKey);
    await this.#setSyncState(sync.id, 'complete');
    return result;
  }

  async #impactCandidates(
    changes: readonly SymbolChange[],
    previousSymbols: ReadonlyMap<string, StoredSymbol>,
  ): Promise<Map<number, ImpactCandidate>> {
    const selected = new Map<number, ImpactCandidate>();
    for (const change of changes) {
      if (!change.before) continue;
      const changed = previousSymbols.get(change.key);
      if (!changed) {
        throw new MemoryDomainError('CORRUPT_GRAPH', `Missing old revision for ${change.key}`);
      }
      for (let callHops = 0; callHops <= MAX_CALL_HOPS; callHops += 1) {
        const response = await this.#hydra.query(impactQuery(callHops), {
          parameters: { changedId: changed.entity.id },
          consistency: 'strong',
        });
        for (let row = 0; row < response.rows.length; row += 1) {
          const state = requiredMemoryState(response, row, 'memoryState');
          if (state !== 'current' && state !== 'needs_review') continue;
          const memoryStored = await this.#graph.inspectEntity(
            requiredNumberCell(response, row, 'memoryId'),
          );
          if (!memoryStored || memoryStored.kind !== 'Memory') {
            throw new MemoryDomainError('CORRUPT_GRAPH', 'Impact query returned invalid memory');
          }
          const memory = immutableEntityFromStored(memoryStored);
          const memoryId = requiredStringProperty(parseEntityPayload(memoryStored), 'memoryId');
          const callers: ImmutableEntity[] = [];
          for (let position = 1; position <= callHops; position += 1) {
            const callerStored = await this.#graph.inspectEntity(
              requiredNumberCell(response, row, `hop${position}Id`),
            );
            if (!callerStored || callerStored.kind !== 'SymbolRevision') {
              throw new MemoryDomainError('CORRUPT_GRAPH', 'Impact query returned invalid caller');
            }
            callers.push(immutableEntityFromStored(callerStored));
          }
          const path = [changed.entity, ...callers, memory];
          const candidate: ImpactCandidate = {
            memory,
            memoryId,
            state,
            changeKey: change.key,
            callHops,
            path,
            pathSignature: path.map((entity) => entity.entityKey).join(' -> '),
          };
          const existing = selected.get(memory.id);
          if (!existing || compareCandidate(candidate, existing) < 0) {
            selected.set(memory.id, candidate);
          }
        }
      }
    }
    return selected;
  }

  async #persistChanges(
    sync: ImmutableEntity,
    changes: readonly SymbolChange[],
    previousSymbols: ReadonlyMap<string, StoredSymbol>,
    nextSnapshot: RepositorySnapshot,
  ): Promise<Map<string, ImmutableEntity>> {
    const nextSymbols = new Map(nextSnapshot.symbols.map((symbol) => [symbol.key, symbol]));
    const entities = new Map<string, ImmutableEntity>();
    for (const change of changes) {
      const entity = createImmutableEntity(
        'Change',
        entityKeys.change(
          nextSnapshot.repositoryId,
          syncProperty(sync, 'fromCommit'),
          nextSnapshot.commit.sha,
          change.key,
        ),
        {
          symbolKey: change.key,
          changeKind: change.kind,
          fromCommit: syncProperty(sync, 'fromCommit'),
          toCommit: nextSnapshot.commit.sha,
          beforeSourceHash: change.before?.sourceHash ?? null,
          afterSourceHash: change.after?.sourceHash ?? null,
        },
      );
      entities.set(change.key, entity);
      await this.#graph.writeRelationship(createImmutableRelationship('FOUND', sync, entity));
      const before = previousSymbols.get(change.key)?.entity;
      if (before) {
        await this.#graph.writeRelationship(createImmutableRelationship('BEFORE', entity, before));
      }
      const next = nextSymbols.get(change.key);
      if (next) {
        await this.#graph.writeRelationship(
          createImmutableRelationship(
            'AFTER',
            entity,
            createSymbolRevisionEntity(nextSnapshot.repositoryId, nextSnapshot.commit.sha, next),
          ),
        );
      }
    }
    return entities;
  }

  async #persistImpacts(
    repositoryId: string,
    sync: ImmutableEntity,
    candidates: ReadonlyMap<number, ImpactCandidate>,
    changes: ReadonlyMap<string, ImmutableEntity>,
    nextSnapshot: RepositorySnapshot,
  ): Promise<void> {
    for (const candidate of [...candidates.values()].sort(
      (left, right) => left.memory.id - right.memory.id,
    )) {
      const change = changes.get(candidate.changeKey);
      if (!change) throw new MemoryDomainError('CORRUPT_GRAPH', 'Impact has no change entity');
      const impact = createImmutableEntity(
        'Impact',
        entityKeys.impact(change.entityKey, candidate.memory.entityKey),
        {
          memoryId: candidate.memoryId,
          fromCommit: syncProperty(sync, 'fromCommit'),
          toCommit: nextSnapshot.commit.sha,
          callHops: candidate.callHops,
          pathSignature: candidate.pathSignature,
        },
      );
      await this.#graph.writeRelationship(createImmutableRelationship('PRODUCED', change, impact));
      await this.#graph.writeRelationship(
        createImmutableRelationship('AFFECTS', impact, candidate.memory),
      );
      for (const [position, target] of candidate.path.entries()) {
        const step = createImmutableEntity(
          'ImpactStep',
          entityKeys.impactStep(impact.entityKey, position),
          {
            position,
            nodeKind: target.kind,
            relationshipFromPrevious:
              position === 0
                ? null
                : target.kind === 'Memory'
                  ? 'SUPPORTED_BY_REVERSE'
                  : 'CALLS_REVERSE',
          },
        );
        await this.#graph.writeRelationship(
          createImmutableRelationship('HAS_STEP', impact, step, {}, String(position)),
        );
        await this.#graph.writeRelationship(createImmutableRelationship('REFERS_TO', step, target));
      }
      const event = createImmutableEntity(
        'MemoryEvent',
        entityKeys.memoryEvent(repositoryId, candidate.memoryId, `invalidated:${sync.entityKey}`),
        {
          memoryId: candidate.memoryId,
          eventType: 'invalidated',
          state: 'needs_review',
          commitSha: nextSnapshot.commit.sha,
          occurredAt: nextSnapshot.commit.committedAt,
          impactKey: impact.entityKey,
        },
      );
      await this.#graph.writeRelationship(
        createImmutableRelationship('HAS_EVENT', candidate.memory, event),
      );
      await this.#memory.setMemoryState(candidate.memory.id, 'needs_review');
    }
  }

  async #symbolsAtCommit(
    repositoryId: string,
    commitSha: string,
  ): Promise<Map<string, StoredSymbol>> {
    const commitId = deterministicIntegerId('entity', entityKeys.commit(repositoryId, commitSha));
    const response = await this.#hydra.query(LIST_SYMBOL_REVISIONS_QUERY, {
      parameters: { commitId },
      consistency: 'strong',
    });
    const symbols = new Map<string, StoredSymbol>();
    for (let row = 0; row < response.rows.length; row += 1) {
      const stored = storedEntityFromRow(response, row, 'symbolId', 'SymbolRevision');
      const payload = parseEntityPayload(stored);
      const snapshot: SymbolSnapshot = {
        key: `${requiredStringProperty(payload, 'path')}::${requiredStringProperty(payload, 'qualifiedName')}`,
        path: requiredStringProperty(payload, 'path'),
        qualifiedName: requiredStringProperty(payload, 'qualifiedName'),
        kind: requiredSymbolKind(payload.properties['symbolKind']),
        sourceHash: requiredStringProperty(payload, 'sourceHash'),
        startLine: requiredIntegerProperty(payload.properties['startLine'], 'startLine'),
        endLine: requiredIntegerProperty(payload.properties['endLine'], 'endLine'),
      };
      if (symbols.has(snapshot.key)) {
        throw new MemoryDomainError('CORRUPT_GRAPH', `Duplicate symbol ${snapshot.key}`);
      }
      symbols.set(snapshot.key, { snapshot, entity: immutableEntityFromStored(stored) });
    }
    return symbols;
  }

  async #repositoryState(repositoryId: string): Promise<RepositoryState> {
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    const response = await this.#hydra.query(INSPECT_REPOSITORY_SYNC_QUERY, {
      parameters: { repositoryId: repositoryVertexId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) {
      return { selectedCommit: null, syncState: 'ready', pendingCommit: null };
    }
    if (response.rows.length !== 1)
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Repository duplicated');
    const syncState = optionalStringCell(response, 0, 'syncState') ?? 'ready';
    if (syncState !== 'ready' && syncState !== 'syncing') {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Repository sync state is invalid');
    }
    const pendingCommit = optionalStringCell(response, 0, 'pendingCommit');
    return {
      selectedCommit: optionalStringCell(response, 0, 'selectedCommit') ?? null,
      syncState,
      pendingCommit: pendingCommit && pendingCommit.length > 0 ? pendingCommit : null,
    };
  }

  async #indexRuns(repositoryId: string): Promise<IndexRunRecord[]> {
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    const response = await this.#hydra.query(LIST_INDEX_RUNS_QUERY, {
      parameters: { repositoryId: repositoryVertexId },
      consistency: 'strong',
    });
    return response.rows
      .map((_, row) => {
        const payload = parseEntityPayload(storedEntityFromRow(response, row, 'runId', 'IndexRun'));
        return {
          commitSha: requiredStringProperty(payload, 'commitSha'),
          committedAt: requiredStringProperty(payload, 'committedAt'),
        };
      })
      .map((run) => {
        if (Number.isNaN(Date.parse(run.committedAt))) {
          throw new MemoryDomainError('CORRUPT_GRAPH', `Index ${run.commitSha} has invalid time`);
        }
        return run;
      })
      .sort(
        (left, right) =>
          Date.parse(right.committedAt) - Date.parse(left.committedAt) ||
          compareText(right.commitSha, left.commitSha),
      );
  }

  async #syncRuns(repositoryId: string): Promise<StoredSyncRun[]> {
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    const response = await this.#hydra.query(LIST_SYNC_RUNS_QUERY, {
      parameters: { repositoryId: repositoryVertexId },
      consistency: 'strong',
    });
    return response.rows.map((_, row) => {
      const stored = storedEntityFromRow(response, row, 'syncId', 'SyncRun');
      const payload = parseEntityPayload(stored);
      const state = optionalStringCell(response, row, 'state') ?? 'pending';
      if (state !== 'pending' && state !== 'complete') {
        throw new MemoryDomainError('CORRUPT_GRAPH', `Sync ${stored.entityKey} state is invalid`);
      }
      const impacted = payload.properties['impactedMemoryIds'];
      if (!Array.isArray(impacted) || !impacted.every((value) => typeof value === 'string')) {
        throw new MemoryDomainError(
          'CORRUPT_GRAPH',
          `Sync ${stored.entityKey} impacts are invalid`,
        );
      }
      return {
        entity: immutableEntityFromStored(stored),
        state,
        result: {
          repositoryId: requiredStringProperty(payload, 'repositoryId'),
          fromCommit: requiredStringProperty(payload, 'fromCommit'),
          toCommit: requiredStringProperty(payload, 'toCommit'),
          changeCount: requiredIntegerProperty(payload.properties['changeCount'], 'changeCount'),
          impactedMemoryIds: impacted,
          reused: false,
        },
      };
    });
  }

  async #setRepositoryField(
    repositoryId: string,
    field: 'selected_commit' | 'sync_state' | 'pending_commit',
    value: string,
    operationKey: string,
  ): Promise<void> {
    const repositoryVertexId = deterministicIntegerId(
      'entity',
      entityKeys.repository(repositoryId),
    );
    await this.#hydra.query(setRepositoryFieldQuery(field), {
      parameters: { repositoryId: repositoryVertexId, value },
      queryId: `freshcontext-repository-field-v1-${createHash('sha256')
        .update(`${operationKey}:${field}:${value}`, 'utf8')
        .digest('hex')}`,
    });
    const state = await this.#repositoryState(repositoryId);
    const actual =
      field === 'selected_commit'
        ? state.selectedCommit
        : field === 'sync_state'
          ? state.syncState
          : await this.#pendingCommit(repositoryVertexId);
    if (actual !== value) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Repository field ${field} did not persist`);
    }
  }

  async #pendingCommit(repositoryId: number): Promise<string> {
    const response = await this.#hydra.query(INSPECT_REPOSITORY_SYNC_QUERY, {
      parameters: { repositoryId },
      consistency: 'strong',
    });
    return optionalStringCell(response, 0, 'pendingCommit') ?? '';
  }

  async #setSyncState(syncId: number, state: 'pending' | 'complete'): Promise<void> {
    const current = await this.#inspectSyncState(syncId);
    if (current === state) return;
    await this.#hydra.query(SET_SYNC_STATE_QUERY, {
      parameters: { syncId, state },
      queryId: `freshcontext-sync-state-v1-${syncId}-${current ?? 'unset'}-to-${state}`,
    });
    if ((await this.#inspectSyncState(syncId)) !== state) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Sync state ${state} did not persist`);
    }
  }

  async #inspectSyncState(syncId: number): Promise<'pending' | 'complete' | undefined> {
    const response = await this.#hydra.query(INSPECT_SYNC_STATE_QUERY, {
      parameters: { syncId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) return undefined;
    const state = optionalStringCell(response, 0, 'state');
    if (state !== undefined && state !== 'pending' && state !== 'complete') {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Sync state is invalid');
    }
    return state;
  }

  async #checkpoint(checkpoint: SyncCheckpoint): Promise<void> {
    await this.#faultInjector?.(checkpoint);
  }
}

function storedEntityFromRow(
  response: HydraQueryResponse,
  row: number,
  idColumn: string,
  expectedKind: string,
): StoredEntity {
  const kind = requiredStringCell(response, row, 'entityKind');
  if (kind !== expectedKind) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Expected ${expectedKind}, received ${kind}`);
  }
  return {
    id: requiredNumberCell(response, row, idColumn),
    entityKey: requiredStringCell(response, row, 'entityKey'),
    kind,
    payloadHash: requiredStringCell(response, row, 'payloadHash'),
    payload: requiredStringCell(response, row, 'payload'),
  };
}

function requiredMemoryState(
  response: HydraQueryResponse,
  row: number,
  column: string,
): MemoryState {
  const state = optionalStringCell(response, row, column) ?? 'pending';
  if (!MEMORY_STATES.includes(state as MemoryState)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Invalid memory state ${state}`);
  }
  return state as MemoryState;
}

function requiredStringCell(response: HydraQueryResponse, row: number, column: string): string {
  const cell = requiredCell(response, row, column);
  if (cell.type !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not a string`);
  }
  return cell.value;
}

function optionalStringCell(
  response: HydraQueryResponse,
  row: number,
  column: string,
): string | undefined {
  const cell = requiredCell(response, row, column);
  if (cell.type === 'null') return undefined;
  if (cell.type !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not a string`);
  }
  return cell.value;
}

function requiredNumberCell(response: HydraQueryResponse, row: number, column: string): number {
  const cell = requiredCell(response, row, column);
  if (
    (cell.type !== 'integer' && cell.type !== 'signed_integer' && cell.type !== 'vertex_id') ||
    !Number.isSafeInteger(cell.value)
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB column ${column} is not an integer`);
  }
  return cell.value;
}

function requiredCell(response: HydraQueryResponse, row: number, column: string) {
  const index = response.columns.indexOf(column);
  const cell = index >= 0 ? response.rows[row]?.[index] : undefined;
  if (!cell) throw new MemoryDomainError('CORRUPT_GRAPH', `HydraDB omitted column ${column}`);
  return cell;
}

function requiredIntegerProperty(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Property ${name} is not an integer`);
  }
  return value;
}

function requiredSymbolKind(value: unknown): SymbolSnapshot['kind'] {
  if (
    value !== 'function' &&
    value !== 'method' &&
    value !== 'arrow-function' &&
    value !== 'function-expression'
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Symbol kind is invalid');
  }
  return value;
}

function syncProperty(sync: ImmutableEntity, property: string): string {
  return requiredStringProperty(
    parseEntityPayload({
      id: sync.id,
      entityKey: sync.entityKey,
      kind: sync.kind,
      payloadHash: sync.payloadHash,
      payload: sync.payload,
    }),
    property,
  );
}

function compareCandidate(left: ImpactCandidate, right: ImpactCandidate): number {
  return left.callHops - right.callHops || compareText(left.pathSignature, right.pathSignature);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}
import { createHash } from 'node:crypto';
