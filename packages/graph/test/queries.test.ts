import { describe, expect, it } from 'vitest';

import { RELATIONSHIP_KINDS } from '../src/model.js';
import {
  INSPECT_ENTITY_QUERY,
  UPSERT_ENTITIES_QUERY,
  inspectRelationshipQuery,
  upsertRelationshipQuery,
} from '../src/queries.js';

describe('released HydraDB query catalog', () => {
  it('uses the released UNWIND MERGE SET vertex upsert shape', () => {
    expect(UPSERT_ENTITIES_QUERY).toContain('UNWIND $rows AS row');
    expect(UPSERT_ENTITIES_QUERY).toContain('MERGE (entity {id: row.vertex_id})');
    expect(UPSERT_ENTITIES_QUERY).toContain('SET entity:FreshContextEntity');
    expect(UPSERT_ENTITIES_QUERY).toContain('entity.entity_key = row.entity_key');
    expect(UPSERT_ENTITIES_QUERY).not.toContain('RETURN');
  });

  it('keeps relationship types inside the reviewed allowlist', () => {
    for (const kind of RELATIONSHIP_KINDS) {
      const upsert = upsertRelationshipQuery(kind);
      const inspect = inspectRelationshipQuery(kind);
      expect(upsert).toContain(`relationship:${kind}`);
      expect(inspect).toContain(`relationship:${kind}`);
      expect(upsert).toContain('source:FreshContextEntity');
      expect(upsert).toContain('target:FreshContextEntity');
      expect(upsert).toContain('MERGE (source)-[');
      expect(upsert).not.toContain('CREATE');
    }
  });

  it('uses strong-read-compatible inspection shapes', () => {
    expect(INSPECT_ENTITY_QUERY).toContain('MATCH (entity {id: $vertexId})');
    expect(inspectRelationshipQuery('SUPERSEDES')).toContain(
      'MATCH (source {id: $sourceId})-[relationship:SUPERSEDES {id: $relationshipId}]->(target {id: $targetId})',
    );
    expect(upsertRelationshipQuery('SUPERSEDES')).toContain(
      'relationship.relationship_id = row.relationship_id',
    );
    expect(inspectRelationshipQuery('SUPERSEDES')).toContain(
      'relationship.relationship_id AS relationshipId',
    );
  });
});
