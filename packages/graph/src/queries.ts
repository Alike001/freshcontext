import type { RelationshipKind } from './model.js';

export const UPSERT_ENTITIES_QUERY = `UNWIND $rows AS row
MERGE (entity {id: row.vertex_id})
SET entity:FreshContextEntity,
    entity.entity_key = row.entity_key,
    entity.entity_kind = row.entity_kind,
    entity.payload_hash = row.payload_hash,
    entity.payload = row.payload`;

export const INSPECT_ENTITY_QUERY = `MATCH (entity {id: $vertexId})
RETURN entity.id AS vertexId,
       entity.entity_key AS entityKey,
       entity.entity_kind AS entityKind,
       entity.payload_hash AS payloadHash,
       entity.payload AS payload`;

export function upsertRelationshipQuery(kind: RelationshipKind): string {
  return `UNWIND $rows AS row
MATCH (source:FreshContextEntity {id: row.source_id}), (target:FreshContextEntity {id: row.target_id})
MERGE (source)-[relationship:${kind} {id: row.relationship_id}]->(target)
SET relationship.relationship_id = row.relationship_id,
    relationship.entity_key = row.entity_key,
    relationship.relationship_kind = row.relationship_kind,
    relationship.payload_hash = row.payload_hash,
    relationship.payload = row.payload`;
}

export function inspectRelationshipQuery(kind: RelationshipKind): string {
  return `MATCH (source {id: $sourceId})-[relationship:${kind} {id: $relationshipId}]->(target {id: $targetId})
RETURN source.id AS sourceId,
       target.id AS targetId,
       relationship.relationship_id AS relationshipId,
       relationship.entity_key AS entityKey,
       relationship.relationship_kind AS relationshipKind,
       relationship.payload_hash AS payloadHash,
       relationship.payload AS payload`;
}
