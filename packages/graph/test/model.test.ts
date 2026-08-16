import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../src/canonical.js';
import { deterministicIntegerId } from '../src/id.js';
import {
  ENTITY_KINDS,
  RELATIONSHIP_KINDS,
  createImmutableEntity,
  createImmutableRelationship,
  entityKeys,
} from '../src/model.js';

describe('deterministic graph identity', () => {
  it('maps stable keys into positive 52-bit integers', () => {
    const first = deterministicIntegerId('entity', 'repository:demo');
    const repeated = deterministicIntegerId('entity', 'repository:demo');
    const relationship = deterministicIntegerId('relationship', 'repository:demo');

    expect(first).toBe(repeated);
    expect(first).not.toBe(relationship);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(2 ** 52);
    expect(Number.isSafeInteger(first)).toBe(true);
  });

  it('canonicalizes property order before hashing immutable payloads', () => {
    const left = createImmutableEntity('Repository', 'repository:demo', {
      name: 'Demo',
      nested: { z: 2, a: 1 },
    });
    const right = createImmutableEntity('Repository', 'repository:demo', {
      nested: { a: 1, z: 2 },
      name: 'Demo',
    });

    expect(left).toEqual(right);
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it('changes the payload hash without changing stable entity identity', () => {
    const original = createImmutableEntity('Repository', 'repository:demo', { name: 'Original' });
    const modified = createImmutableEntity('Repository', 'repository:demo', { name: 'Modified' });

    expect(original.id).toBe(modified.id);
    expect(original.payloadHash).not.toBe(modified.payloadHash);
  });

  it('defines every V1 immutable vertex and relationship kind', () => {
    expect(ENTITY_KINDS).toContain('SymbolRevision');
    expect(ENTITY_KINDS).toContain('MemoryEvent');
    expect(ENTITY_KINDS).toContain('Change');
    expect(ENTITY_KINDS).toContain('Impact');
    expect(RELATIONSHIP_KINDS).toContain('SUPPORTED_BY');
    expect(RELATIONSHIP_KINDS).toContain('SUPERSEDES');
    expect(RELATIONSHIP_KINDS).toContain('AFFECTS');
  });

  it('builds commit-bound file and symbol revision keys', () => {
    const symbol = entityKeys.symbol('demo', 'src/payments.ts', 'checkout');
    const revision = entityKeys.symbolRevision('demo', 'abc123', 'src/payments.ts', 'checkout');

    expect(symbol).toContain('repository:demo:file:src%2Fpayments.ts:symbol:checkout');
    expect(revision).toContain('commit:abc123:file:src%2Fpayments.ts:symbol:checkout');
  });

  it('derives relationship identity from type, endpoints, and scope', () => {
    const source = createImmutableEntity('Repository', 'repository:demo', { name: 'Demo' });
    const target = createImmutableEntity('Commit', 'repository:demo:commit:abc', { sha: 'abc' });
    const first = createImmutableRelationship('HAS_COMMIT', source, target, {}, 'selected');
    const repeated = createImmutableRelationship('HAS_COMMIT', source, target, {}, 'selected');
    const otherScope = createImmutableRelationship('HAS_COMMIT', source, target, {}, 'parent');

    expect(first).toEqual(repeated);
    expect(first.id).not.toBe(otherScope.id);
    expect(first.payload).toContain('"scope":"selected"');
  });

  it('bounds long composite identities without losing deterministic uniqueness', () => {
    const longPath = `${'deep/'.repeat(140)}payments.ts`;
    const first = entityKeys.symbolRevision('demo', 'abc123', longPath, 'checkout');
    const repeated = entityKeys.symbolRevision('demo', 'abc123', longPath, 'checkout');
    const different = entityKeys.symbolRevision('demo', 'abc123', longPath, 'refund');

    expect(first).toBe(repeated);
    expect(first).not.toBe(different);
    expect(first.length).toBeLessThanOrEqual(512);
    expect(first).toContain('sha256:');
  });

  it('rejects unsafe identifiers and payload numbers', () => {
    expect(() => deterministicIntegerId('entity', ' bad')).toThrow('surrounding whitespace');
    expect(() => createImmutableEntity('ImpactStep', 'impact:1', { position: 1.5 })).toThrow(
      'safe integers',
    );
    expect(() => entityKeys.impactStep('impact:1', -1)).toThrow('non-negative');
  });
});
