export type HydraConsistency = 'causal' | 'strong';

export type HydraValue =
  | { readonly type: 'null' }
  | { readonly type: 'vertex_id'; readonly value: number }
  | { readonly type: 'integer'; readonly value: number }
  | { readonly type: 'signed_integer'; readonly value: number }
  | { readonly type: 'float'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'list'; readonly value: readonly HydraValue[] }
  | { readonly type: 'path'; readonly value: unknown };

export interface HydraQueryResponse {
  readonly query_id: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly HydraValue[])[];
  readonly read_epoch: number | null;
  readonly next_cursor: number | null;
  readonly bookmark: string | null;
}

export interface HydraQueryOptions {
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly consistency?: HydraConsistency;
  readonly queryId?: string;
}

export interface HydraClientConfig {
  readonly queryBaseUrl: string;
  readonly adminBaseUrl: string;
  readonly graphId: string;
  readonly namespace: string;
  readonly cellId: string;
  readonly token: string;
  readonly timeoutMs: number;
}

export interface HydraRoundTrip {
  readonly queryId: string;
  readonly readEpoch: number | null;
}
