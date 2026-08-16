import { readFileSync } from 'node:fs';

import type { HydraClientConfig } from './types.js';

const DEFAULT_QUERY_BASE_URL = 'http://hydra:8443';
const DEFAULT_ADMIN_BASE_URL = 'http://hydra:9090';
const DEFAULT_GRAPH_ID = 'freshcontext';
const DEFAULT_NAMESPACE = 'freshcontext';
const DEFAULT_CELL_ID = 'cell-0';
const DEFAULT_TIMEOUT_MS = 5_000;

export type HydraEnvironment = Readonly<Record<string, string | undefined>>;

function requiredToken(environment: HydraEnvironment): string {
  const inlineToken = environment['HYDRA_AUTH_TOKEN']?.trim();
  if (inlineToken) {
    return validateToken(inlineToken);
  }

  const tokenFile = environment['HYDRA_AUTH_TOKEN_FILE'];
  if (!tokenFile) {
    throw new Error('HYDRA_AUTH_TOKEN_FILE is required');
  }

  let token: string;
  try {
    token = readFileSync(tokenFile, 'utf8').trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown read error';
    throw new Error(`Unable to read the HydraDB token file: ${reason}`, { cause: error });
  }

  return validateToken(token);
}

function validateToken(token: string): string {
  if (token.length < 32) {
    throw new Error('The HydraDB bearer token must contain at least 32 characters');
  }
  return token;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function normalizedUrl(value: string | undefined, fallback: string): string {
  const url = new URL(value ?? fallback);
  return url.toString().replace(/\/$/, '');
}

export function loadHydraConfig(environment: HydraEnvironment = process.env): HydraClientConfig {
  return {
    queryBaseUrl: normalizedUrl(environment['HYDRA_QUERY_BASE_URL'], DEFAULT_QUERY_BASE_URL),
    adminBaseUrl: normalizedUrl(environment['HYDRA_ADMIN_BASE_URL'], DEFAULT_ADMIN_BASE_URL),
    graphId: environment['HYDRA_GRAPH_ID'] ?? DEFAULT_GRAPH_ID,
    namespace: environment['HYDRA_GRAPH_NAMESPACE'] ?? DEFAULT_NAMESPACE,
    cellId: environment['HYDRA_CELL_ID'] ?? DEFAULT_CELL_ID,
    token: requiredToken(environment),
    timeoutMs: positiveInteger(
      environment['HYDRA_REQUEST_TIMEOUT_MS'],
      DEFAULT_TIMEOUT_MS,
      'HYDRA_REQUEST_TIMEOUT_MS',
    ),
  };
}
