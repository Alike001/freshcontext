import { createHash } from 'node:crypto';

import { hasControlCharacters } from './text.js';

const LOW_32_FACTOR = 4_294_967_296;
export const MAX_ENTITY_KEY_LENGTH = 512;

export type IdDomain = 'entity' | 'relationship';

export function deterministicIntegerId(domain: IdDomain, entityKey: string): number {
  const normalizedKey = validateEntityKey(entityKey);
  const digest = createHash('sha256')
    .update(`freshcontext:v1:${domain}:${normalizedKey}`, 'utf8')
    .digest();

  const high20 = ((digest[0] ?? 0) & 0x0f) * 65_536 + (digest[1] ?? 0) * 256 + (digest[2] ?? 0);
  const low32 = digest.readUInt32BE(3);
  const id = high20 * LOW_32_FACTOR + low32;
  return id === 0 ? 1 : id;
}

export function validateEntityKey(entityKey: string): string {
  if (entityKey.length === 0 || entityKey.length > MAX_ENTITY_KEY_LENGTH) {
    throw new Error(`Entity keys must contain between 1 and ${MAX_ENTITY_KEY_LENGTH} characters`);
  }
  if (entityKey.trim() !== entityKey || hasControlCharacters(entityKey)) {
    throw new Error('Entity keys cannot contain surrounding whitespace or control characters');
  }
  return entityKey;
}
