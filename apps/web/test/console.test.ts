import { describe, expect, it } from 'vitest';

import { parseConsoleResponse } from '../src/data/console.js';

const response = {
  status: 'ready',
  source: 'example',
  repositoryId: 'checkout',
  repositoryLabel: 'Checkout example',
  selectedCommit: 'b'.repeat(40),
  memories: [
    {
      memoryId: 'memory-1',
      claim: 'A claim',
      state: 'needs_review',
      sourceCommit: 'a'.repeat(40),
      createdAt: '2026-08-12T09:00:00.000Z',
      evidence: [{ path: 'src/a.ts', qualifiedName: 'a' }],
    },
  ],
  selected: {
    memory: {
      memoryId: 'memory-1',
      claim: 'A claim',
      state: 'needs_review',
      sourceCommit: 'a'.repeat(40),
      createdAt: '2026-08-12T09:00:00.000Z',
      evidence: [{ path: 'src/a.ts', qualifiedName: 'a' }],
    },
    impact: null,
    chronology: [],
    replacement: null,
    original: null,
    diff: null,
  },
} as const;

describe('Proof Console API parser', () => {
  it('accepts a complete verified dossier', () => {
    expect(parseConsoleResponse(response)).toEqual(response);
  });

  it('rejects an invented lifecycle state', () => {
    expect(() =>
      parseConsoleResponse({
        ...response,
        memories: [{ ...response.memories[0], state: 'probably_current' }],
      }),
    ).toThrow('Invalid memory state');
  });

  it('rejects a short commit identifier', () => {
    expect(() => parseConsoleResponse({ ...response, selectedCommit: 'deadbeef' })).toThrow(
      'Invalid commit',
    );
  });
});
