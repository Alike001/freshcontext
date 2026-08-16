import { describe, expect, it } from 'vitest';

import { loadHydraConfig } from '../src/config.js';

describe('loadHydraConfig', () => {
  it('accepts a backend-only inline token for native development', () => {
    const config = loadHydraConfig({
      HYDRA_AUTH_TOKEN: 'x'.repeat(64),
      HYDRA_QUERY_BASE_URL: 'http://127.0.0.1:8443/',
      HYDRA_ADMIN_BASE_URL: 'http://127.0.0.1:9090/',
    });

    expect(config.queryBaseUrl).toBe('http://127.0.0.1:8443');
    expect(config.adminBaseUrl).toBe('http://127.0.0.1:9090');
    expect(config.token).toHaveLength(64);
  });

  it('rejects missing credentials', () => {
    expect(() => loadHydraConfig({})).toThrow('HYDRA_AUTH_TOKEN_FILE is required');
  });

  it('rejects a short credential', () => {
    expect(() => loadHydraConfig({ HYDRA_AUTH_TOKEN: 'too-short' })).toThrow(
      'must contain at least 32 characters',
    );
  });

  it('rejects invalid request timeouts', () => {
    expect(() =>
      loadHydraConfig({
        HYDRA_AUTH_TOKEN: 'x'.repeat(64),
        HYDRA_REQUEST_TIMEOUT_MS: '0',
      }),
    ).toThrow('HYDRA_REQUEST_TIMEOUT_MS must be a positive integer');
  });
});
