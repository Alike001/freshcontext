export const SET_MEMORY_STATE_QUERY = `MATCH (memory:FreshContextEntity {id: $memoryId})
SET memory.state = $state`;

export const INSPECT_MEMORY_STATE_QUERY = `MATCH (memory {id: $memoryId})
RETURN memory.id AS memoryId,
       memory.state AS state`;

export const RECALL_MEMORIES_QUERY = `MATCH (memory:FreshContextEntity)-[:SUPPORTED_BY]->(evidence:FreshContextEntity {id: $evidenceId})
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
