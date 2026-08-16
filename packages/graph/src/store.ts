import { createHash } from 'node:crypto';

import {
  HydraRequestError,
  type HydraQueryOptions,
  type HydraQueryResponse,
} from '@freshcontext/hydra';

import { canonicalJson, type JsonObject, type JsonValue } from './canonical.js';
import type { ImmutableEntity, ImmutableRelationship, RelationshipKind } from './model.js';
import {
  INSPECT_ENTITY_QUERY,
  UPSERT_ENTITIES_QUERY,
  inspectRelationshipQuery,
  upsertRelationshipQuery,
} from './queries.js';

export interface StoredEntity {
  readonly id: number;
  readonly entityKey: string;
  readonly kind: string;
  readonly payloadHash: string;
  readonly payload: string;
}

export interface StoredRelationship {
  readonly sourceId: number;
  readonly targetId: number;
  readonly id: number;
  readonly entityKey: string;
  readonly kind: string;
  readonly payloadHash: string;
  readonly payload: string;
}

export interface PersistedGraphRecord {
  readonly source: StoredEntity;
  readonly relationship: StoredRelationship;
  readonly target: StoredEntity;
}

export interface HydraQueryGateway {
  query(query: string, options?: HydraQueryOptions): Promise<HydraQueryResponse>;
}

export class GraphCollisionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GraphCollisionError';
  }
}

export class ImmutableGraphStore {
  readonly #hydra: HydraQueryGateway;
  readonly #verifiedEntities = new Map<number, StoredEntity>();
  readonly #verifiedRelationships = new Map<string, StoredRelationship>();

  public constructor(hydra: HydraQueryGateway) {
    this.#hydra = hydra;
  }

  public async writeRelationship(
    relationship: ImmutableRelationship,
  ): Promise<PersistedGraphRecord> {
    const entities = uniqueEntities([relationship.source, relationship.target]);
    const existingEntities = new Map<number, StoredEntity>();

    for (const entity of entities) {
      const cached = this.#verifiedEntities.get(entity.id);
      if (cached) {
        assertEntityMatches(entity, cached);
        existingEntities.set(entity.id, cached);
        continue;
      }
      const existing = await this.inspectEntity(entity.id);
      if (existing) {
        assertEntityMatches(entity, existing);
        existingEntities.set(entity.id, existing);
        this.#verifiedEntities.set(entity.id, existing);
      }
    }

    const missingEntities = entities.filter((entity) => !existingEntities.has(entity.id));

    if (missingEntities.length > 0) {
      const rows = missingEntities.map(entityRow);
      await this.#hydra.query(UPSERT_ENTITIES_QUERY, {
        parameters: { rows },
        queryId: mutationId('entity-upsert', rows),
      });
    }

    for (const entity of missingEntities) {
      const stored = await this.requireMatchingEntity(entity);
      existingEntities.set(entity.id, stored);
      this.#verifiedEntities.set(entity.id, stored);
    }

    const source = requiredStoredEntity(existingEntities, relationship.source);
    const target = requiredStoredEntity(existingEntities, relationship.target);

    const cacheKey = relationshipCacheKey(relationship);
    const cachedRelationship = this.#verifiedRelationships.get(cacheKey);
    if (cachedRelationship) {
      assertRelationshipMatches(relationship, cachedRelationship);
      return { source, relationship: cachedRelationship, target };
    }
    const existingRelationship = await this.inspectRelationship(
      relationship.kind,
      relationship.id,
      relationship.source.id,
      relationship.target.id,
    );
    if (existingRelationship) {
      assertRelationshipMatches(relationship, existingRelationship);
      this.#verifiedRelationships.set(cacheKey, existingRelationship);
      return { source, relationship: existingRelationship, target };
    }

    const rows = [relationshipRow(relationship)];
    await this.#hydra.query(upsertRelationshipQuery(relationship.kind), {
      parameters: { rows },
      queryId: mutationId('relationship-upsert', rows),
    });

    const storedRelationship = await this.inspectRelationship(
      relationship.kind,
      relationship.id,
      relationship.source.id,
      relationship.target.id,
    );
    if (!storedRelationship) {
      throw new HydraRequestError('HydraDB did not return the relationship after its write', {});
    }
    assertRelationshipMatches(relationship, storedRelationship);
    this.#verifiedRelationships.set(cacheKey, storedRelationship);
    return { source, relationship: storedRelationship, target };
  }

  public async inspectEntity(id: number): Promise<StoredEntity | undefined> {
    const response = await this.#hydra.query(INSPECT_ENTITY_QUERY, {
      parameters: { vertexId: id },
      consistency: 'strong',
    });
    if (response.rows.length === 0) {
      return undefined;
    }
    if (response.rows.length !== 1) {
      throw new GraphCollisionError(
        `HydraDB returned ${response.rows.length} vertices for id ${id}`,
      );
    }

    const storedId = requiredNumber(response, 0, 'vertexId');
    const entityKey = optionalString(response, 0, 'entityKey');
    const kind = optionalString(response, 0, 'entityKind');
    const payloadHash = optionalString(response, 0, 'payloadHash');
    const payload = optionalString(response, 0, 'payload');
    const metadata = [entityKey, kind, payloadHash, payload];
    if (metadata.every((value) => value === undefined)) {
      return undefined;
    }
    if (
      entityKey === undefined ||
      kind === undefined ||
      payloadHash === undefined ||
      payload === undefined
    ) {
      throw new GraphCollisionError(
        `HydraDB vertex ${storedId} contains incomplete immutable metadata`,
      );
    }

    return {
      id: storedId,
      entityKey,
      kind,
      payloadHash,
      payload,
    };
  }

  public async inspectRelationship(
    kind: RelationshipKind,
    id: number,
    sourceId: number,
    targetId: number,
  ): Promise<StoredRelationship | undefined> {
    const response = await this.#hydra.query(inspectRelationshipQuery(kind), {
      parameters: { relationshipId: id, sourceId, targetId },
      consistency: 'strong',
    });
    if (response.rows.length === 0) {
      return undefined;
    }
    if (response.rows.length !== 1) {
      throw new GraphCollisionError(
        `HydraDB returned ${response.rows.length} ${kind} relationships for id ${id}`,
      );
    }

    return {
      sourceId: requiredNumber(response, 0, 'sourceId'),
      targetId: requiredNumber(response, 0, 'targetId'),
      id: requiredNumber(response, 0, 'relationshipId'),
      entityKey: requiredString(response, 0, 'entityKey'),
      kind: requiredString(response, 0, 'relationshipKind'),
      payloadHash: requiredString(response, 0, 'payloadHash'),
      payload: requiredString(response, 0, 'payload'),
    };
  }

  async #requireEntity(entity: ImmutableEntity): Promise<StoredEntity> {
    const stored = await this.inspectEntity(entity.id);
    if (!stored) {
      throw new HydraRequestError(
        `HydraDB did not return entity ${entity.entityKey} after its write`,
        {},
      );
    }
    return stored;
  }

  async requireMatchingEntity(entity: ImmutableEntity): Promise<StoredEntity> {
    const stored = await this.#requireEntity(entity);
    assertEntityMatches(entity, stored);
    return stored;
  }
}

function relationshipCacheKey(relationship: ImmutableRelationship): string {
  return `${relationship.source.id}:${relationship.kind}:${relationship.id}:${relationship.target.id}`;
}

function uniqueEntities(entities: readonly ImmutableEntity[]): ImmutableEntity[] {
  const unique = new Map<number, ImmutableEntity>();
  for (const entity of entities) {
    const existing = unique.get(entity.id);
    if (existing) {
      assertEntityMatches(entity, existing);
    }
    unique.set(entity.id, entity);
  }
  return [...unique.values()].sort((left, right) => left.id - right.id);
}

function requiredStoredEntity(
  entities: ReadonlyMap<number, StoredEntity>,
  expected: ImmutableEntity,
): StoredEntity {
  const stored = entities.get(expected.id);
  if (!stored) {
    throw new HydraRequestError(`HydraDB did not verify entity ${expected.entityKey}`, {});
  }
  return stored;
}

function entityRow(entity: ImmutableEntity): JsonObject {
  return {
    vertex_id: entity.id,
    entity_key: entity.entityKey,
    entity_kind: entity.kind,
    payload_hash: entity.payloadHash,
    payload: entity.payload,
  };
}

function relationshipRow(relationship: ImmutableRelationship): JsonObject {
  return {
    source_id: relationship.source.id,
    target_id: relationship.target.id,
    relationship_id: relationship.id,
    entity_key: relationship.entityKey,
    relationship_kind: relationship.kind,
    payload_hash: relationship.payloadHash,
    payload: relationship.payload,
  };
}

function mutationId(operation: string, values: readonly JsonValue[]): string {
  const digest = createHash('sha256').update(canonicalJson(values), 'utf8').digest('hex');
  return `freshcontext-${operation}-v1-${digest}`;
}

function assertEntityMatches(expected: ImmutableEntity, actual: StoredEntity): void {
  if (
    actual.id !== expected.id ||
    actual.entityKey !== expected.entityKey ||
    actual.kind !== expected.kind ||
    actual.payloadHash !== expected.payloadHash ||
    actual.payload !== expected.payload
  ) {
    throw new GraphCollisionError(
      `Immutable entity collision for id ${expected.id}: expected ${expected.entityKey}, found ${actual.entityKey}`,
    );
  }
}

function assertRelationshipMatches(
  expected: ImmutableRelationship,
  actual: StoredRelationship,
): void {
  if (
    actual.sourceId !== expected.source.id ||
    actual.targetId !== expected.target.id ||
    actual.id !== expected.id ||
    actual.entityKey !== expected.entityKey ||
    actual.kind !== expected.kind ||
    actual.payloadHash !== expected.payloadHash ||
    actual.payload !== expected.payload
  ) {
    throw new GraphCollisionError(
      `Immutable relationship collision for id ${expected.id}: expected ${expected.entityKey}, found ${actual.entityKey}`,
    );
  }
}

function requiredString(response: HydraQueryResponse, row: number, column: string): string {
  const value = cell(response, row, column);
  if (value.type !== 'string') {
    throw new HydraRequestError(`HydraDB column ${column} was not a string`, {});
  }
  return value.value;
}

function optionalString(
  response: HydraQueryResponse,
  row: number,
  column: string,
): string | undefined {
  const value = cell(response, row, column);
  if (value.type === 'null') {
    return undefined;
  }
  if (value.type !== 'string') {
    throw new HydraRequestError(`HydraDB column ${column} was not a string or null`, {});
  }
  return value.value;
}

function requiredNumber(response: HydraQueryResponse, row: number, column: string): number {
  const value = cell(response, row, column);
  if (value.type !== 'integer' && value.type !== 'signed_integer' && value.type !== 'vertex_id') {
    throw new HydraRequestError(`HydraDB column ${column} was not an integer`, {});
  }
  if (!Number.isSafeInteger(value.value)) {
    throw new HydraRequestError(`HydraDB column ${column} was not a safe integer`, {});
  }
  return value.value;
}

function cell(response: HydraQueryResponse, row: number, column: string) {
  const columnIndex = response.columns.indexOf(column);
  const value = columnIndex >= 0 ? response.rows[row]?.[columnIndex] : undefined;
  if (!value) {
    throw new HydraRequestError(`HydraDB omitted required column ${column}`, {});
  }
  return value;
}
