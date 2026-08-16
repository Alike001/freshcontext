import { describe, expect, it } from 'vitest';

import { parseSetupResponse } from '../src/data/setup.js';

const setupResponse = {
  status: 'ready',
  hydra: 'connected',
  startupCommand: 'docker compose up --build --wait',
  repository: {
    state: 'indexed',
    id: 'checkout',
    path: '/workspace/checkout',
    indexedCommit: 'a'.repeat(40),
    statistics: { symbolCount: 9 },
    message: 'The selected repository has a completed HydraDB index.',
  },
} as const;

describe('setup API parser', () => {
  it('accepts the complete verified setup response', () => {
    expect(parseSetupResponse(setupResponse)).toEqual(setupResponse);
  });

  it('rejects an unknown repository state', () => {
    expect(() =>
      parseSetupResponse({
        ...setupResponse,
        repository: { ...setupResponse.repository, state: 'pretend_ready' },
      }),
    ).toThrow('Invalid repository setup state');
  });

  it('rejects non-numeric repository statistics', () => {
    expect(() =>
      parseSetupResponse({
        ...setupResponse,
        repository: { ...setupResponse.repository, statistics: { symbolCount: 'nine' } },
      }),
    ).toThrow('Invalid repository statistics');
  });
});
