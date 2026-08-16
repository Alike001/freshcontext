import type {
  HydraClientConfig,
  HydraQueryOptions,
  HydraQueryResponse,
  HydraValue,
} from './types.js';

type Fetch = typeof fetch;

interface HydraErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
  };
}

export class HydraRequestError extends Error {
  public readonly status: number | undefined;
  public readonly code: string | undefined;

  public constructor(
    message: string,
    options: { status?: number; code?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'HydraRequestError';
    this.status = options.status;
    this.code = options.code;
  }
}

export class HydraClient {
  readonly #config: HydraClientConfig;
  readonly #fetch: Fetch;

  public constructor(config: HydraClientConfig, fetchImplementation: Fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  public async isAdminReady(): Promise<boolean> {
    try {
      const response = await this.#fetch(`${this.#config.adminBaseUrl}/readyz`, {
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async query(query: string, options: HydraQueryOptions = {}): Promise<HydraQueryResponse> {
    if (query.trim().length === 0) {
      throw new HydraRequestError('A non-empty HydraDB query is required', {});
    }

    const queryId = options.queryId ?? crypto.randomUUID();
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#config.queryBaseUrl}/v1/graphs/${encodeURIComponent(this.#config.graphId)}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#config.token}`,
            'Content-Type': 'application/json',
            'X-Graph-Namespace': this.#config.namespace,
          },
          body: JSON.stringify({
            cell_id: this.#config.cellId,
            query,
            query_id: queryId,
            parameters: options.parameters ?? {},
            ...(options.consistency ? { consistency: options.consistency } : {}),
          }),
          signal: AbortSignal.timeout(this.#config.timeoutMs),
        },
      );
    } catch (error) {
      throw new HydraRequestError('HydraDB could not be reached', { cause: error });
    }

    const rawBody = await response.text();
    if (!response.ok) {
      const hydraError = parseErrorEnvelope(rawBody);
      throw new HydraRequestError(hydraError.message, {
        status: response.status,
        ...(hydraError.code ? { code: hydraError.code } : {}),
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch (error) {
      throw new HydraRequestError('HydraDB returned invalid JSON', { cause: error });
    }

    if (!isQueryResponse(body)) {
      throw new HydraRequestError('HydraDB returned an unexpected response shape', {});
    }
    return body;
  }
}

function parseErrorEnvelope(rawBody: string): { message: string; code?: string } {
  try {
    const body = JSON.parse(rawBody) as HydraErrorEnvelope;
    const message = body.error?.message;
    const code = body.error?.code;
    return {
      message:
        typeof message === 'string'
          ? `HydraDB rejected the query: ${message}`
          : 'HydraDB rejected the query',
      ...(typeof code === 'string' ? { code } : {}),
    };
  } catch {
    return { message: 'HydraDB rejected the query' };
  }
}

function isQueryResponse(value: unknown): value is HydraQueryResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['query_id'] === 'string' &&
    isStringArray(value['columns']) &&
    Array.isArray(value['rows']) &&
    value['rows'].every((row) => Array.isArray(row) && row.every((cell) => isHydraValue(cell))) &&
    isNullableNumber(value['read_epoch']) &&
    isNullableNumber(value['next_cursor']) &&
    isNullableString(value['bookmark'])
  );
}

function isHydraValue(value: unknown): value is HydraValue {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }

  if (value['type'] === 'null') {
    return true;
  }
  if (value['type'] === 'string') {
    return typeof value['value'] === 'string';
  }
  if (value['type'] === 'boolean') {
    return typeof value['value'] === 'boolean';
  }
  if (
    value['type'] === 'vertex_id' ||
    value['type'] === 'integer' ||
    value['type'] === 'signed_integer' ||
    value['type'] === 'float'
  ) {
    return typeof value['value'] === 'number' && Number.isFinite(value['value']);
  }
  if (value['type'] === 'list') {
    return Array.isArray(value['value']) && value['value'].every((item) => isHydraValue(item));
  }
  return value['type'] === 'path' && 'value' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
