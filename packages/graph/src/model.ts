import { canonicalJson, payloadHash, type JsonObject } from './canonical.js';
import { MAX_ENTITY_KEY_LENGTH, deterministicIntegerId, validateEntityKey } from './id.js';
import { hasControlCharacters } from './text.js';

export const ENTITY_KINDS = [
  'GraphRoot',
  'Repository',
  'Commit',
  'File',
  'FileRevision',
  'Symbol',
  'SymbolRevision',
  'Memory',
  'MemoryEvent',
  'IndexRun',
  'SyncRun',
  'Change',
  'Impact',
  'ImpactStep',
  'ReviewOperation',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const RELATIONSHIP_KINDS = [
  'ROOT_HAS_REPOSITORY',
  'HAS_INDEX_RUN',
  'HAS_SYNC_RUN',
  'HAS_REVIEW_OPERATION',
  'HAS_COMMIT',
  'HAS_FILE',
  'HAS_FILE_REVISION',
  'HAS_REVISION',
  'DECLARES',
  'REVISION_OF',
  'IMPORTS',
  'CALLS',
  'SUPPORTED_BY',
  'HAS_EVENT',
  'SUPERSEDES',
  'FOUND',
  'BEFORE',
  'AFTER',
  'PRODUCED',
  'AFFECTS',
  'HAS_STEP',
  'REFERS_TO',
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export interface ImmutableEntity {
  readonly id: number;
  readonly entityKey: string;
  readonly kind: EntityKind;
  readonly payload: string;
  readonly payloadHash: string;
}

export interface ImmutableRelationship {
  readonly id: number;
  readonly entityKey: string;
  readonly kind: RelationshipKind;
  readonly source: ImmutableEntity;
  readonly target: ImmutableEntity;
  readonly payload: string;
  readonly payloadHash: string;
}

export function createImmutableEntity(
  kind: EntityKind,
  entityKey: string,
  properties: JsonObject,
): ImmutableEntity {
  const validatedKey = validateEntityKey(entityKey);
  const immutablePayload = { entityKey: validatedKey, kind, properties } as const;
  return {
    id: deterministicIntegerId('entity', validatedKey),
    entityKey: validatedKey,
    kind,
    payload: canonicalJson(immutablePayload),
    payloadHash: payloadHash(immutablePayload),
  };
}

export function createImmutableRelationship(
  kind: RelationshipKind,
  source: ImmutableEntity,
  target: ImmutableEntity,
  properties: JsonObject = {},
  scope = 'default',
): ImmutableRelationship {
  const encodedScope = keyPart('scope', scope);
  const entityKey = boundedKey(
    `relationship:${kind}:${source.entityKey}:${target.entityKey}:${encodedScope}`,
    `relationship:${kind}`,
    [source.entityKey, target.entityKey, scope],
  );
  const immutablePayload = {
    entityKey,
    kind,
    source: source.entityKey,
    target: target.entityKey,
    scope,
    properties,
  } as const;
  return {
    id: deterministicIntegerId('relationship', entityKey),
    entityKey,
    kind,
    source,
    target,
    payload: canonicalJson(immutablePayload),
    payloadHash: payloadHash(immutablePayload),
  };
}

function keyPart(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value || hasControlCharacters(value)) {
    throw new Error(`${name} must be a non-empty value without surrounding whitespace`);
  }
  return encodeURIComponent(value);
}

function boundedKey(readable: string, namespace: string, identity: readonly string[]): string {
  if (readable.length <= MAX_ENTITY_KEY_LENGTH) {
    return validateEntityKey(readable);
  }
  return validateEntityKey(`${namespace}:sha256:${payloadHash(identity)}`);
}

export const entityKeys = {
  graphRoot: (): string => 'freshcontext:root:v1',
  repository: (repositoryId: string): string => {
    const repository = keyPart('repositoryId', repositoryId);
    return boundedKey(`repository:${repository}`, 'repository', [repositoryId]);
  },
  commit: (repositoryId: string, commitSha: string): string => {
    const commit = keyPart('commitSha', commitSha);
    return boundedKey(`${entityKeys.repository(repositoryId)}:commit:${commit}`, 'commit', [
      repositoryId,
      commitSha,
    ]);
  },
  file: (repositoryId: string, path: string): string => {
    const encodedPath = keyPart('path', path);
    return boundedKey(`${entityKeys.repository(repositoryId)}:file:${encodedPath}`, 'file', [
      repositoryId,
      path,
    ]);
  },
  fileRevision: (repositoryId: string, commitSha: string, path: string): string => {
    const encodedPath = keyPart('path', path);
    return boundedKey(
      `${entityKeys.commit(repositoryId, commitSha)}:file:${encodedPath}`,
      'file-revision',
      [repositoryId, commitSha, path],
    );
  },
  symbol: (repositoryId: string, path: string, qualifiedName: string): string => {
    const symbol = keyPart('qualifiedName', qualifiedName);
    return boundedKey(`${entityKeys.file(repositoryId, path)}:symbol:${symbol}`, 'symbol', [
      repositoryId,
      path,
      qualifiedName,
    ]);
  },
  symbolRevision: (
    repositoryId: string,
    commitSha: string,
    path: string,
    qualifiedName: string,
  ): string => {
    const symbol = keyPart('qualifiedName', qualifiedName);
    return boundedKey(
      `${entityKeys.fileRevision(repositoryId, commitSha, path)}:symbol:${symbol}`,
      'symbol-revision',
      [repositoryId, commitSha, path, qualifiedName],
    );
  },
  memory: (repositoryId: string, memoryId: string): string => {
    const memory = keyPart('memoryId', memoryId);
    return boundedKey(`${entityKeys.repository(repositoryId)}:memory:${memory}`, 'memory', [
      repositoryId,
      memoryId,
    ]);
  },
  memoryEvent: (repositoryId: string, memoryId: string, eventId: string): string => {
    const event = keyPart('eventId', eventId);
    return boundedKey(
      `${entityKeys.memory(repositoryId, memoryId)}:event:${event}`,
      'memory-event',
      [repositoryId, memoryId, eventId],
    );
  },
  indexRun: (repositoryId: string, commitSha: string): string =>
    boundedKey(`${entityKeys.commit(repositoryId, commitSha)}:index-run`, 'index-run', [
      repositoryId,
      commitSha,
    ]),
  syncRun: (repositoryId: string, fromSha: string, toSha: string): string => {
    const from = keyPart('fromSha', fromSha);
    const to = keyPart('toSha', toSha);
    return boundedKey(`${entityKeys.repository(repositoryId)}:sync:${from}:${to}`, 'sync-run', [
      repositoryId,
      fromSha,
      toSha,
    ]);
  },
  change: (repositoryId: string, fromSha: string, toSha: string, symbolKey: string): string => {
    const symbol = keyPart('symbolKey', symbolKey);
    return boundedKey(
      `${entityKeys.syncRun(repositoryId, fromSha, toSha)}:change:${symbol}`,
      'change',
      [repositoryId, fromSha, toSha, symbolKey],
    );
  },
  impact: (changeKey: string, memoryKey: string): string => {
    const change = keyPart('changeKey', changeKey);
    const memory = keyPart('memoryKey', memoryKey);
    return boundedKey(`${change}:impact:${memory}`, 'impact', [changeKey, memoryKey]);
  },
  impactStep: (impactKey: string, position: number): string => {
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new Error('Impact step position must be a non-negative safe integer');
    }
    const impact = keyPart('impactKey', impactKey);
    return boundedKey(`${impact}:step:${position}`, 'impact-step', [impactKey, String(position)]);
  },
  reviewOperation: (repositoryId: string, operationId: string): string => {
    const operation = keyPart('operationId', operationId);
    return boundedKey(
      `${entityKeys.repository(repositoryId)}:review:${operation}`,
      'review-operation',
      [repositoryId, operationId],
    );
  },
} as const;
