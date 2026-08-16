import { describe, expect, it } from 'vitest';

import { createImmutableEntity, type StoredEntity } from '@freshcontext/graph';

import { MemoryDomainError } from '../src/errors.js';
import { parseEntityPayload } from '../src/payload.js';
import { LIST_INDEX_RUNS_QUERY, RECALL_MEMORIES_QUERY, impactQuery } from '../src/queries.js';

describe('immutable domain payloads', () => {
  it('accepts a matching canonical payload', () => {
    const entity = createImmutableEntity('Memory', 'memory:test', { claim: 'Verified' });
    expect(parseEntityPayload(entity).properties['claim']).toBe('Verified');
  });

  it('rejects a payload whose stored hash was altered', () => {
    const entity = createImmutableEntity('Memory', 'memory:test', { claim: 'Verified' });
    const altered: StoredEntity = { ...entity, payloadHash: '0'.repeat(64) };
    expect(() => parseEntityPayload(altered)).toThrowError(MemoryDomainError);
  });

  it('reads immutable metadata directly from HydraDB in recall and status queries', () => {
    for (const query of [RECALL_MEMORIES_QUERY, LIST_INDEX_RUNS_QUERY]) {
      expect(query).toContain('.entity_key AS entityKey');
      expect(query).toContain('.entity_kind AS entityKind');
      expect(query).toContain('.payload_hash AS payloadHash');
    }
  });

  it('uses four explicit bounded impact query shapes', () => {
    const queries = [0, 1, 2, 3].map(impactQuery);
    expect(queries).toHaveLength(4);
    expect(queries.every((query) => !query.includes('*'))).toBe(true);
    expect(queries[3]?.match(/\[:CALLS\]/gu)).toHaveLength(3);
    expect(() => impactQuery(4)).toThrow(/zero to three/u);
  });
});
