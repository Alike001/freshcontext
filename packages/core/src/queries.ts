export const SET_MEMORY_STATE_QUERY = `MATCH (memory:FreshContextEntity {id: $memoryId})
SET memory.state = $state`;

export const INSPECT_MEMORY_STATE_QUERY = `MATCH (memory {id: $memoryId})
RETURN memory.id AS memoryId,
       memory.state AS state`;

export const RESOLVE_STABLE_SYMBOL_QUERY = `MATCH (evidence:FreshContextEntity {id: $evidenceId})-[:REVISION_OF]->(symbol:FreshContextEntity)
RETURN symbol.id AS symbolId`;

export const RECALL_MEMORIES_QUERY = `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(supported:FreshContextEntity)-[:REVISION_OF]->(symbol:FreshContextEntity {id: $symbolId})
RETURN memory.id AS memoryId,
       memory.entity_key AS entityKey,
       memory.entity_kind AS entityKind,
       memory.payload_hash AS payloadHash,
       memory.payload AS payload,
       memory.state AS state
ORDER BY memory.id`;

export const LIST_INDEX_RUNS_QUERY = `MATCH (repository:FreshContextEntity {id: $repositoryId})-[:HAS_INDEX_RUN]->(run:FreshContextEntity)
RETURN run.id AS runId,
       run.entity_key AS entityKey,
       run.entity_kind AS entityKind,
       run.payload_hash AS payloadHash,
       run.payload AS payload
ORDER BY run.id`;

export const INSPECT_REPOSITORY_SYNC_QUERY = `MATCH (repository {id: $repositoryId})
RETURN repository.id AS repositoryId,
       repository.selected_commit AS selectedCommit,
       repository.sync_state AS syncState,
       repository.pending_commit AS pendingCommit`;

const REPOSITORY_MUTABLE_FIELDS = ['selected_commit', 'sync_state', 'pending_commit'] as const;
type RepositoryMutableField = (typeof REPOSITORY_MUTABLE_FIELDS)[number];

export function setRepositoryFieldQuery(field: RepositoryMutableField): string {
  if (!REPOSITORY_MUTABLE_FIELDS.includes(field)) {
    throw new Error(`Unsupported repository field ${field}`);
  }
  return `MATCH (repository:FreshContextEntity {id: $repositoryId})
SET repository.${field} = $value`;
}

export const LIST_SYMBOL_REVISIONS_QUERY = `MATCH (commit:FreshContextEntity {id: $commitId})-[:HAS_FILE_REVISION]->(file:FreshContextEntity)-[:DECLARES]->(symbol:FreshContextEntity)
RETURN symbol.id AS symbolId,
       symbol.entity_key AS entityKey,
       symbol.entity_kind AS entityKind,
       symbol.payload_hash AS payloadHash,
       symbol.payload AS payload
ORDER BY symbol.id`;

export const SET_SYNC_STATE_QUERY = `MATCH (sync:FreshContextEntity {id: $syncId})
SET sync.state = $state`;

export const INSPECT_SYNC_STATE_QUERY = `MATCH (sync {id: $syncId})
RETURN sync.id AS syncId,
       sync.state AS state`;

export const LIST_SYNC_RUNS_QUERY = `MATCH (repository:FreshContextEntity {id: $repositoryId})-[:HAS_SYNC_RUN]->(sync:FreshContextEntity)
RETURN sync.id AS syncId,
       sync.entity_key AS entityKey,
       sync.entity_kind AS entityKind,
       sync.payload_hash AS payloadHash,
       sync.payload AS payload,
       sync.state AS state
ORDER BY sync.id`;

const IMPACT_QUERIES = [
  `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(changed:FreshContextEntity {id: $changedId})
RETURN memory.id AS memoryId,
       memory.state AS memoryState
ORDER BY memory.id`,
  `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(hop1:FreshContextEntity)-[:CALLS]->(changed:FreshContextEntity {id: $changedId})
RETURN memory.id AS memoryId,
       memory.state AS memoryState,
       hop1.id AS hop1Id
ORDER BY memory.id`,
  `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(hop2:FreshContextEntity)-[:CALLS]->(hop1:FreshContextEntity)-[:CALLS]->(changed:FreshContextEntity {id: $changedId})
RETURN memory.id AS memoryId,
       memory.state AS memoryState,
       hop1.id AS hop1Id,
       hop2.id AS hop2Id
ORDER BY memory.id`,
  `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(hop3:FreshContextEntity)-[:CALLS]->(hop2:FreshContextEntity)-[:CALLS]->(hop1:FreshContextEntity)-[:CALLS]->(changed:FreshContextEntity {id: $changedId})
RETURN memory.id AS memoryId,
       memory.state AS memoryState,
       hop1.id AS hop1Id,
       hop2.id AS hop2Id,
       hop3.id AS hop3Id
ORDER BY memory.id`,
] as const;

export function impactQuery(callHops: number): string {
  const query = IMPACT_QUERIES[callHops];
  if (!query) throw new Error('Impact traversal supports exactly zero to three call hops');
  return query;
}

export const INSPECT_MEMORY_IMPACTS_QUERY = `MATCH (impact:FreshContextEntity)-[:AFFECTS]->(memory:FreshContextEntity {id: $memoryId})
RETURN impact.id AS impactId,
       impact.entity_key AS entityKey,
       impact.entity_kind AS entityKind,
       impact.payload_hash AS payloadHash,
       impact.payload AS payload
ORDER BY impact.id`;

export const SET_REVIEW_STATE_QUERY = `MATCH (review:FreshContextEntity {id: $reviewId})
SET review.state = $state`;

export const INSPECT_REVIEW_STATE_QUERY = `MATCH (review {id: $reviewId})
RETURN review.id AS reviewId,
       review.state AS state`;

export const INSPECT_SUPERSESSION_QUERY = `MATCH (replacement:FreshContextEntity)-[:SUPERSEDES]->(original:FreshContextEntity {id: $originalId})
RETURN replacement.id AS replacementId,
       original.id AS originalId`;

export const LIST_MEMORIES_QUERY = `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(evidence:FreshContextEntity)
RETURN memory.id AS memoryId,
       memory.entity_key AS entityKey,
       memory.entity_kind AS entityKind,
       memory.payload_hash AS payloadHash,
       memory.payload AS payload,
       memory.state AS state
ORDER BY memory.id`;

export const LIST_MEMORY_IMPACTS_QUERY = `MATCH (change:FreshContextEntity)-[:PRODUCED]->(impact:FreshContextEntity)-[:AFFECTS]->(memory:FreshContextEntity {id: $memoryId})
RETURN change.id AS changeId,
       change.entity_key AS changeEntityKey,
       change.entity_kind AS changeEntityKind,
       change.payload_hash AS changePayloadHash,
       change.payload AS changePayload,
       impact.id AS impactId,
       impact.entity_key AS impactEntityKey,
       impact.entity_kind AS impactEntityKind,
       impact.payload_hash AS impactPayloadHash,
       impact.payload AS impactPayload
ORDER BY impact.id`;

export const LIST_IMPACT_STEPS_QUERY = `MATCH (impact:FreshContextEntity {id: $impactId})-[:HAS_STEP]->(step:FreshContextEntity)-[:REFERS_TO]->(target:FreshContextEntity)
RETURN step.id AS stepId,
       step.entity_key AS stepEntityKey,
       step.entity_kind AS stepEntityKind,
       step.payload_hash AS stepPayloadHash,
       step.payload AS stepPayload,
       target.id AS targetId,
       target.entity_key AS targetEntityKey,
       target.entity_kind AS targetEntityKind,
       target.payload_hash AS targetPayloadHash,
       target.payload AS targetPayload
ORDER BY step.id`;

export const LIST_MEMORY_EVENTS_QUERY = `MATCH (memory:FreshContextEntity {id: $memoryId})-[:HAS_EVENT]->(event:FreshContextEntity)
RETURN event.id AS eventId,
       event.entity_key AS eventEntityKey,
       event.entity_kind AS eventEntityKind,
       event.payload_hash AS eventPayloadHash,
       event.payload AS eventPayload
ORDER BY event.id`;

export const FIND_MEMORY_REPLACEMENT_QUERY = `MATCH (replacement:FreshContextEntity)-[:SUPERSEDES]->(original:FreshContextEntity {id: $memoryId})
RETURN replacement.id AS linkedMemoryId,
       replacement.entity_key AS entityKey,
       replacement.entity_kind AS entityKind,
       replacement.payload_hash AS payloadHash,
       replacement.payload AS payload,
       replacement.state AS state
ORDER BY replacement.id`;

export const FIND_MEMORY_ORIGINAL_QUERY = `MATCH (replacement:FreshContextEntity {id: $memoryId})-[:SUPERSEDES]->(original:FreshContextEntity)
RETURN original.id AS linkedMemoryId,
       original.entity_key AS entityKey,
       original.entity_kind AS entityKind,
       original.payload_hash AS payloadHash,
       original.payload AS payload,
       original.state AS state
ORDER BY original.id`;
