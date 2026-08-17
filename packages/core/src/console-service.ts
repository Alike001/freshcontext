import { type HydraQueryGateway, type StoredEntity } from '@freshcontext/graph';
import type { HydraQueryResponse } from '@freshcontext/hydra';

import type {
  ConsoleDossier,
  ConsoleImpact,
  ConsoleImpactChange,
  ConsoleImpactStep,
  ConsoleMemoryEvent,
  ConsoleMemorySummary,
  ConsoleReadResult,
  ReadConsoleInput,
} from './console-types.js';
import { MemoryDomainError } from './errors.js';
import { parseEntityPayload, requiredStringProperty } from './payload.js';
import {
  FIND_MEMORY_ORIGINAL_QUERY,
  FIND_MEMORY_REPLACEMENT_QUERY,
  LIST_IMPACT_STEPS_QUERY,
  LIST_MEMORIES_QUERY,
  LIST_MEMORY_EVENTS_QUERY,
  LIST_MEMORY_IMPACTS_QUERY,
} from './queries.js';
import { MEMORY_STATES, type EvidenceReference, type MemoryState } from './types.js';

const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;

export class ConsoleService {
  readonly #hydra: HydraQueryGateway;

  public constructor(hydra: HydraQueryGateway) {
    this.#hydra = hydra;
  }

  public async read(input: ReadConsoleInput): Promise<ConsoleReadResult> {
    validateIdentifier('repositoryId', input.repositoryId);
    if (!COMMIT_SHA.test(input.selectedCommit)) {
      throw new MemoryDomainError('INVALID_INPUT', 'selectedCommit must be a full Git SHA');
    }
    if (input.memoryId !== undefined) validateIdentifier('memoryId', input.memoryId);

    const response = await this.#hydra.query(LIST_MEMORIES_QUERY, { consistency: 'strong' });
    const byId = new Map<
      string,
      { readonly entityId: number; readonly summary: ConsoleMemorySummary }
    >();
    for (let row = 0; row < response.rows.length; row += 1) {
      const stored = storedEntityFromRow(response, row, '', 'memoryId', 'Memory');
      const summary = memorySummary(stored, memoryState(response, row));
      if (summaryRepositoryId(stored) !== input.repositoryId) continue;
      byId.set(summary.memoryId, { entityId: stored.id, summary });
    }
    const memories = [...byId.values()].map((entry) => entry.summary).sort(compareMemory);
    const requested = input.memoryId ? byId.get(input.memoryId) : undefined;
    if (input.memoryId && !requested) {
      throw new MemoryDomainError('EVIDENCE_NOT_FOUND', `Memory ${input.memoryId} does not exist`);
    }
    const selectedEntry =
      requested ??
      [...byId.values()].sort((left, right) => compareMemory(left.summary, right.summary))[0];
    const selected = selectedEntry
      ? await this.#dossier(selectedEntry.entityId, selectedEntry.summary, input.selectedCommit)
      : null;
    return {
      repositoryId: input.repositoryId,
      selectedCommit: input.selectedCommit,
      memories,
      selected,
    };
  }

  async #dossier(
    entityId: number,
    memory: ConsoleMemorySummary,
    selectedCommit: string,
  ): Promise<ConsoleDossier> {
    const [impact, chronology, replacement, original] = await Promise.all([
      this.#impact(entityId, selectedCommit),
      this.#chronology(entityId),
      this.#linkedMemory(FIND_MEMORY_REPLACEMENT_QUERY, entityId),
      this.#linkedMemory(FIND_MEMORY_ORIGINAL_QUERY, entityId),
    ]);
    return { memory, impact, chronology, replacement, original };
  }

  async #impact(memoryId: number, selectedCommit: string): Promise<ConsoleImpact | null> {
    const response = await this.#hydra.query(LIST_MEMORY_IMPACTS_QUERY, {
      parameters: { memoryId },
      consistency: 'strong',
    });
    for (let row = response.rows.length - 1; row >= 0; row -= 1) {
      const change = storedEntityFromRow(response, row, 'change', 'changeId', 'Change');
      const impact = storedEntityFromRow(response, row, 'impact', 'impactId', 'Impact');
      const impactPayload = parseEntityPayload(impact);
      if (requiredStringProperty(impactPayload, 'toCommit') !== selectedCommit) continue;
      const steps = await this.#impactSteps(impact.id);
      return {
        callHops: requiredInteger(impactPayload.properties['callHops'], 'callHops'),
        pathSignature: requiredStringProperty(impactPayload, 'pathSignature'),
        change: changeRecord(change),
        steps,
      };
    }
    return null;
  }

  async #impactSteps(impactId: number): Promise<ConsoleImpactStep[]> {
    const response = await this.#hydra.query(LIST_IMPACT_STEPS_QUERY, {
      parameters: { impactId },
      consistency: 'strong',
    });
    return response.rows
      .map((_, row) => {
        const step = storedEntityFromRow(response, row, 'step', 'stepId', 'ImpactStep');
        const target = storedEntityFromRow(response, row, 'target', 'targetId');
        const stepPayload = parseEntityPayload(step);
        const targetPayload = parseEntityPayload(target);
        const nodeKind = requiredStringProperty(stepPayload, 'nodeKind');
        if (nodeKind !== 'SymbolRevision' && nodeKind !== 'Memory') {
          throw new MemoryDomainError('CORRUPT_GRAPH', `Invalid impact node kind ${nodeKind}`);
        }
        const relationship = nullableString(stepPayload.properties['relationshipFromPrevious']);
        if (
          relationship !== null &&
          relationship !== 'CALLS_REVERSE' &&
          relationship !== 'SUPPORTED_BY_REVERSE'
        ) {
          throw new MemoryDomainError('CORRUPT_GRAPH', 'Invalid impact relationship');
        }
        return {
          position: requiredInteger(stepPayload.properties['position'], 'position'),
          nodeKind,
          relationshipFromPrevious: relationship,
          path:
            nodeKind === 'SymbolRevision' ? requiredStringProperty(targetPayload, 'path') : null,
          qualifiedName:
            nodeKind === 'SymbolRevision'
              ? requiredStringProperty(targetPayload, 'qualifiedName')
              : null,
          memoryId:
            nodeKind === 'Memory' ? requiredStringProperty(targetPayload, 'memoryId') : null,
          claim: nodeKind === 'Memory' ? requiredStringProperty(targetPayload, 'claim') : null,
        } satisfies ConsoleImpactStep;
      })
      .sort((left, right) => left.position - right.position);
  }

  async #chronology(memoryId: number): Promise<ConsoleMemoryEvent[]> {
    const response = await this.#hydra.query(LIST_MEMORY_EVENTS_QUERY, {
      parameters: { memoryId },
      consistency: 'strong',
    });
    return response.rows
      .map((_, row) => {
        const event = storedEntityFromRow(response, row, 'event', 'eventId', 'MemoryEvent');
        const payload = parseEntityPayload(event);
        const eventType = requiredStringProperty(payload, 'eventType');
        if (
          eventType !== 'created' &&
          eventType !== 'invalidated' &&
          eventType !== 'superseded' &&
          eventType !== 'reviewed-replacement'
        ) {
          throw new MemoryDomainError('CORRUPT_GRAPH', `Invalid memory event ${eventType}`);
        }
        const occurredAt = requiredStringProperty(payload, 'occurredAt');
        if (Number.isNaN(Date.parse(occurredAt))) {
          throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory event time is invalid');
        }
        return {
          eventType,
          state: stateProperty(payload.properties['state']),
          commitSha: requiredStringProperty(payload, 'commitSha'),
          occurredAt,
        } satisfies ConsoleMemoryEvent;
      })
      .sort(
        (left, right) =>
          eventRank(left.eventType) - eventRank(right.eventType) ||
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
          left.eventType.localeCompare(right.eventType, 'en'),
      );
  }

  async #linkedMemory(query: string, memoryId: number): Promise<ConsoleMemorySummary | null> {
    const response = await this.#hydra.query(query, {
      parameters: { memoryId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) return null;
    if (response.rows.length !== 1) {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory has multiple supersession links');
    }
    return memorySummary(
      storedEntityFromRow(response, 0, '', 'linkedMemoryId', 'Memory'),
      memoryState(response, 0),
    );
  }
}

function memorySummary(stored: StoredEntity, state: MemoryState): ConsoleMemorySummary {
  const payload = parseEntityPayload(stored);
  const createdAt = requiredStringProperty(payload, 'createdAt');
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory creation time is invalid');
  }
  const evidenceValue = payload.properties['evidence'];
  if (!Array.isArray(evidenceValue)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory evidence is invalid');
  }
  const evidence: EvidenceReference[] = evidenceValue.map((entry) => {
    if (!isRecord(entry)) {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory evidence item is invalid');
    }
    const path = entry['path'];
    const qualifiedName = entry['qualifiedName'];
    if (typeof path !== 'string' || typeof qualifiedName !== 'string') {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Memory evidence item is incomplete');
    }
    return { path, qualifiedName };
  });
  return {
    memoryId: requiredStringProperty(payload, 'memoryId'),
    claim: requiredStringProperty(payload, 'claim'),
    state,
    sourceCommit: requiredStringProperty(payload, 'sourceCommit'),
    createdAt,
    evidence,
  };
}

function summaryRepositoryId(stored: StoredEntity): string {
  return requiredStringProperty(parseEntityPayload(stored), 'repositoryId');
}

function changeRecord(stored: StoredEntity): ConsoleImpactChange {
  const payload = parseEntityPayload(stored);
  const changeKind = requiredStringProperty(payload, 'changeKind');
  if (changeKind !== 'added' && changeKind !== 'changed' && changeKind !== 'removed') {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Invalid change kind ${changeKind}`);
  }
  return {
    symbolKey: requiredStringProperty(payload, 'symbolKey'),
    changeKind,
    fromCommit: requiredStringProperty(payload, 'fromCommit'),
    toCommit: requiredStringProperty(payload, 'toCommit'),
    beforeSourceHash: nullableString(payload.properties['beforeSourceHash']),
    afterSourceHash: nullableString(payload.properties['afterSourceHash']),
  };
}

function storedEntityFromRow(
  response: HydraQueryResponse,
  row: number,
  prefix: string,
  idColumn: string,
  expectedKind?: StoredEntity['kind'],
): StoredEntity {
  const column = (name: string) =>
    `${prefix}${prefix ? (name[0]?.toUpperCase() ?? '') : ''}${prefix ? name.slice(1) : name}`;
  const stored = {
    id: requiredNumberCell(response, row, idColumn),
    entityKey: requiredStringCell(response, row, column('entityKey')),
    kind: requiredStringCell(response, row, column('entityKind')),
    payloadHash: requiredStringCell(response, row, column('payloadHash')),
    payload: requiredStringCell(response, row, column('payload')),
  } as StoredEntity;
  if (expectedKind && stored.kind !== expectedKind) {
    throw new MemoryDomainError(
      'CORRUPT_GRAPH',
      `Expected ${expectedKind}, received ${stored.kind}`,
    );
  }
  return stored;
}

function memoryState(response: HydraQueryResponse, row: number): MemoryState {
  const state = optionalStringCell(response, row, 'state') ?? 'pending';
  return stateProperty(state);
}

function stateProperty(value: unknown): MemoryState {
  if (typeof value !== 'string' || !MEMORY_STATES.includes(value as MemoryState)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Invalid memory state ${String(value)}`);
  }
  return value as MemoryState;
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

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `${name} is not a non-negative integer`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Expected a string or null');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.length > 200 || value.trim() !== value) {
    throw new MemoryDomainError('INVALID_INPUT', `${name} is invalid`);
  }
}

function compareMemory(left: ConsoleMemorySummary, right: ConsoleMemorySummary): number {
  return (
    stateRank(left.state) - stateRank(right.state) ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.memoryId.localeCompare(right.memoryId, 'en')
  );
}

function stateRank(state: MemoryState): number {
  return state === 'needs_review' ? 0 : state === 'current' ? 1 : state === 'pending' ? 2 : 3;
}

function eventRank(event: ConsoleMemoryEvent['eventType']): number {
  return event === 'created' ? 0 : event === 'invalidated' ? 1 : event === 'superseded' ? 2 : 3;
}
