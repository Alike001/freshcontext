import { describe, expect, it } from 'vitest';

import { createImmutableEntity, type StoredEntity } from '@freshcontext/graph';

import { MemoryDomainError } from '../src/errors.js';
import { parseEntityPayload } from '../src/payload.js';
import { LIST_INDEX_RUNS_QUERY, RECALL_MEMORIES_QUERY } from '../src/queries.js';

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
});
