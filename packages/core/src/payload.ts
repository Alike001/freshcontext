import { createHash } from 'node:crypto';

import {
  ENTITY_KINDS,
  type EntityKind,
  type ImmutableEntity,
  type JsonValue,
  type StoredEntity,
} from '@freshcontext/graph';

import { MemoryDomainError } from './errors.js';

export interface EntityPayload {
  readonly entityKey: string;
  readonly kind: EntityKind;
  readonly properties: Readonly<Record<string, JsonValue>>;
}

export function parseEntityPayload(stored: StoredEntity): EntityPayload {
  const actualHash = createHash('sha256').update(stored.payload, 'utf8').digest('hex');
  if (actualHash !== stored.payloadHash) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Entity ${stored.id} payload hash does not match`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.payload) as unknown;
  } catch {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Entity ${stored.id} contains invalid JSON`);
  }
  if (!isRecord(parsed) || !isJsonObject(parsed['properties'])) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Entity ${stored.id} has an invalid payload`);
  }
  const entityKey = parsed['entityKey'];
  const kind = parsed['kind'];
  if (
    typeof entityKey !== 'string' ||
    typeof kind !== 'string' ||
    !ENTITY_KINDS.includes(kind as EntityKind) ||
    entityKey !== stored.entityKey ||
    kind !== stored.kind
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', `Entity ${stored.id} metadata does not match`);
  }
  return {
    entityKey,
    kind: kind as EntityKind,
    properties: parsed['properties'],
  };
}

export function immutableEntityFromStored(stored: StoredEntity): ImmutableEntity {
  const payload = parseEntityPayload(stored);
  return {
    id: stored.id,
    entityKey: stored.entityKey,
    kind: payload.kind,
    payload: stored.payload,
    payloadHash: stored.payloadHash,
  };
}

export function requiredStringProperty(payload: EntityPayload, property: string): string {
  const value = payload.properties[property];
  if (typeof value !== 'string') {
    throw new MemoryDomainError(
      'CORRUPT_GRAPH',
      `${payload.kind} ${payload.entityKey} is missing string property ${property}`,
    );
  }
  return value;
}

export function numberProperties(payload: EntityPayload, property: string): Record<string, number> {
  const value = payload.properties[property];
  if (!isRecord(value)) {
    throw new MemoryDomainError(
      'CORRUPT_GRAPH',
      `${payload.kind} ${payload.entityKey} is missing object property ${property}`,
    );
  }
  const numbers: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) {
      throw new MemoryDomainError('CORRUPT_GRAPH', `Index statistic ${key} is invalid`);
    }
    numbers[key] = entry;
  }
  return numbers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
