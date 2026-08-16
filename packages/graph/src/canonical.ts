import { createHash } from 'node:crypto';

import { hasControlCharacters } from './text.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

const MAX_PAYLOAD_BYTES = 65_536;

export function canonicalJson(value: JsonValue): string {
  const canonical = JSON.stringify(normalize(value));
  if (Buffer.byteLength(canonical, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error(`Immutable graph payloads cannot exceed ${MAX_PAYLOAD_BYTES} bytes`);
  }
  return canonical;
}

export function payloadHash(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function normalize(value: JsonValue): JsonValue {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('Graph payload numbers must be finite safe integers');
    }
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (isJsonArray(value)) {
    return value.map((entry) => normalize(entry));
  }

  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (key.length === 0 || hasControlCharacters(key)) {
      throw new Error('Graph payload property names must be non-empty printable strings');
    }
    const entry = value[key];
    if (entry === undefined) {
      throw new Error(`Graph payload property ${key} cannot be undefined`);
    }
    normalized[key] = normalize(entry);
  }
  return normalized;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
