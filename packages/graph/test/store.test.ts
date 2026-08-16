import { describe, expect, it } from 'vitest';

import type { HydraQueryOptions, HydraQueryResponse, HydraValue } from '@freshcontext/hydra';

import { createImmutableEntity, createImmutableRelationship } from '../src/model.js';
import { GraphCollisionError, ImmutableGraphStore, type HydraQueryGateway } from '../src/store.js';

interface StoredRow {
  readonly id: number;
  readonly entity_key: string;
  readonly entity_kind: string;
  readonly payload_hash: string;
  readonly payload: string;
}

interface EntityInputRow {
  readonly vertex_id: number;
  readonly entity_key: string;
  readonly entity_kind: string;
  readonly payload_hash: string;
  readonly payload: string;
}

interface StoredRelationshipRow {
  readonly source_id: number;
  readonly target_id: number;
  readonly relationship_id: number;
  readonly entity_key: string;
  readonly relationship_kind: string;
  readonly payload_hash: string;
  readonly payload: string;
}

class InMemoryHydraGateway implements HydraQueryGateway {
  public readonly entities = new Map<number, StoredRow>();
  public readonly relationships = new Map<number, StoredRelationshipRow[]>();
  public readonly mutations: { query: string; queryId: string }[] = [];

  public query(query: string, options: HydraQueryOptions = {}): Promise<HydraQueryResponse> {
    const parameters = options.parameters ?? {};
    if (query.startsWith('MATCH (entity')) {
      const id = parameters['vertexId'] as number;
      const entity = this.entities.get(id);
      return Promise.resolve(
        response(
          ['vertexId', 'entityKey', 'entityKind', 'payloadHash', 'payload'],
          entity
            ? [
                [
                  entity.id,
                  entity.entity_key,
                  entity.entity_kind,
                  entity.payload_hash,
                  entity.payload,
                ],
              ]
            : [],
        ),
      );
    }
    if (query.includes('MERGE (entity')) {
      const rows = parameters['rows'] as EntityInputRow[];
      for (const row of rows) {
        this.entities.set(row.vertex_id, {
          id: row.vertex_id,
          entity_key: row.entity_key,
          entity_kind: row.entity_kind,
          payload_hash: row.payload_hash,
          payload: row.payload,
        });
      }
      this.mutations.push({ query, queryId: options.queryId ?? '' });
      return Promise.resolve(response([], []));
    }
    if (query.startsWith('MATCH (source {id: $sourceId})-[relationship:')) {
      const id = parameters['relationshipId'] as number;
      const rows = this.relationships.get(id) ?? [];
      return Promise.resolve(
        response(
          [
            'sourceId',
            'targetId',
            'relationshipId',
            'entityKey',
            'relationshipKind',
            'payloadHash',
            'payload',
          ],
          rows.map((row) => [
            row.source_id,
            row.target_id,
            row.relationship_id,
            row.entity_key,
            row.relationship_kind,
            row.payload_hash,
            row.payload,
          ]),
        ),
      );
    }
    if (query.includes('MERGE (source)-[relationship:')) {
      const rows = parameters['rows'] as StoredRelationshipRow[];
      for (const row of rows) {
        const existing = this.relationships.get(row.relationship_id) ?? [];
        if (existing.length === 0) {
          this.relationships.set(row.relationship_id, [row]);
        }
      }
      this.mutations.push({ query, queryId: options.queryId ?? '' });
      return Promise.resolve(response([], []));
    }
    throw new Error(`Unexpected query: ${query}`);
  }
}

describe('ImmutableGraphStore', () => {
  it('writes one immutable relationship and makes retries duplicate-free', async () => {
    const gateway = new InMemoryHydraGateway();
    const store = new ImmutableGraphStore(gateway);
    const root = createImmutableEntity('GraphRoot', 'freshcontext:root:v1', { version: 1 });
    const repository = createImmutableEntity('Repository', 'repository:demo', { name: 'Demo' });
    const relationship = createImmutableRelationship('ROOT_HAS_REPOSITORY', root, repository);

    const first = await store.writeRelationship(relationship);
    const second = await store.writeRelationship(relationship);

    expect(first).toEqual(second);
    expect(gateway.relationships.get(relationship.id)).toHaveLength(1);
    expect(gateway.mutations).toHaveLength(2);
    expect(gateway.mutations[0]?.queryId).toMatch(/^freshcontext-entity-upsert-v1-[a-f0-9]{64}$/u);
    expect(gateway.mutations[1]?.queryId).toMatch(
      /^freshcontext-relationship-upsert-v1-[a-f0-9]{64}$/u,
    );
  });

  it('rejects a deterministic id collision before issuing a mutation', async () => {
    const gateway = new InMemoryHydraGateway();
    const store = new ImmutableGraphStore(gateway);
    const root = createImmutableEntity('GraphRoot', 'freshcontext:root:v1', { version: 1 });
    const repository = createImmutableEntity('Repository', 'repository:demo', { name: 'Demo' });
    gateway.entities.set(root.id, {
      id: root.id,
      entity_key: 'poisoned:key',
      entity_kind: root.kind,
      payload_hash: root.payloadHash,
      payload: root.payload,
    });

    await expect(
      store.writeRelationship(createImmutableRelationship('ROOT_HAS_REPOSITORY', root, repository)),
    ).rejects.toBeInstanceOf(GraphCollisionError);
    expect(gateway.mutations).toHaveLength(0);
  });

  it('rejects attempts to overwrite immutable payloads', async () => {
    const gateway = new InMemoryHydraGateway();
    const store = new ImmutableGraphStore(gateway);
    const root = createImmutableEntity('GraphRoot', 'freshcontext:root:v1', { version: 1 });
    const original = createImmutableEntity('Repository', 'repository:demo', { name: 'Original' });
    await store.writeRelationship(
      createImmutableRelationship('ROOT_HAS_REPOSITORY', root, original),
    );

    const modified = createImmutableEntity('Repository', 'repository:demo', { name: 'Modified' });
    await expect(
      store.writeRelationship(createImmutableRelationship('ROOT_HAS_REPOSITORY', root, modified)),
    ).rejects.toBeInstanceOf(GraphCollisionError);
    expect(gateway.entities.get(original.id)?.payload_hash).toBe(original.payloadHash);
  });

  it('detects duplicate relationship rows rather than selecting one silently', async () => {
    const gateway = new InMemoryHydraGateway();
    const store = new ImmutableGraphStore(gateway);
    const root = createImmutableEntity('GraphRoot', 'freshcontext:root:v1', { version: 1 });
    const repository = createImmutableEntity('Repository', 'repository:demo', { name: 'Demo' });
    const relationship = createImmutableRelationship('ROOT_HAS_REPOSITORY', root, repository);
    const row: StoredRelationshipRow = {
      source_id: root.id,
      target_id: repository.id,
      relationship_id: relationship.id,
      entity_key: relationship.entityKey,
      relationship_kind: relationship.kind,
      payload_hash: relationship.payloadHash,
      payload: relationship.payload,
    };
    gateway.relationships.set(relationship.id, [row, row]);

    await expect(
      store.inspectRelationship(
        relationship.kind,
        relationship.id,
        relationship.source.id,
        relationship.target.id,
      ),
    ).rejects.toThrow('returned 2');
  });

  it('treats HydraDB all-null vertex metadata as an unmaterialized placeholder', async () => {
    const gateway: HydraQueryGateway = {
      query: () =>
        Promise.resolve({
          query_id: 'placeholder',
          columns: ['vertexId', 'entityKey', 'entityKind', 'payloadHash', 'payload'],
          rows: [
            [
              { type: 'integer', value: 42 },
              { type: 'null' },
              { type: 'null' },
              { type: 'null' },
              { type: 'null' },
            ],
          ],
          read_epoch: 1,
          next_cursor: null,
          bookmark: null,
        }),
    };

    await expect(new ImmutableGraphStore(gateway).inspectEntity(42)).resolves.toBeUndefined();
  });
});

function response(columns: string[], rows: (string | number)[][]): HydraQueryResponse {
  return {
    query_id: 'test-query',
    columns,
    rows: rows.map((row) => row.map(toHydraValue)),
    read_epoch: 1,
    next_cursor: null,
    bookmark: null,
  };
}

function toHydraValue(value: string | number): HydraValue {
  return typeof value === 'string' ? { type: 'string', value } : { type: 'integer', value };
}
