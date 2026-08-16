import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type RepositorySetupState =
  'not_configured' | 'misconfigured' | 'not_indexed' | 'indexed' | 'context_unavailable';

export interface SetupResponse {
  readonly status: 'ready';
  readonly hydra: 'connected' | 'unavailable';
  readonly startupCommand: string;
  readonly repository: {
    readonly state: RepositorySetupState;
    readonly id: string | null;
    readonly path: string | null;
    readonly indexedCommit: string | null;
    readonly statistics: Readonly<Record<string, number>> | null;
    readonly message: string;
  };
}

type SetupResource =
  | { readonly state: 'loading'; readonly data: null; readonly message: string }
  | { readonly state: 'ready'; readonly data: SetupResponse; readonly message: string }
  | { readonly state: 'error'; readonly data: null; readonly message: string };

interface SetupContextValue {
  readonly resource: SetupResource;
  readonly refresh: () => void;
}

const SetupContext = createContext<SetupContextValue | null>(null);

export function SetupProvider({ children }: { readonly children: ReactNode }) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [resource, setResource] = useState<SetupResource>({
    state: 'loading',
    data: null,
    message: 'Checking HydraDB and local repository state.',
  });

  useEffect(() => {
    const controller = new AbortController();
    setResource({
      state: 'loading',
      data: null,
      message: 'Checking HydraDB and local repository state.',
    });
    void fetch('/api/setup', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Setup request failed with ${response.status}`);
        return parseSetupResponse(await response.json());
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResource({ state: 'ready', data, message: 'Local setup state verified.' });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResource({
          state: 'error',
          data: null,
          message:
            error instanceof Error
              ? `FreshContext setup is unavailable: ${error.message}`
              : 'FreshContext setup is unavailable.',
        });
      });
    return () => controller.abort();
  }, [requestVersion]);

  const value = useMemo<SetupContextValue>(
    () => ({
      resource,
      refresh: () => setRequestVersion((current) => current + 1),
    }),
    [resource],
  );
  return <SetupContext value={value}>{children}</SetupContext>;
}

export function useSetup(): SetupContextValue {
  const context = useContext(SetupContext);
  if (!context) throw new Error('useSetup must be used inside SetupProvider');
  return context;
}

export function parseSetupResponse(value: unknown): SetupResponse {
  if (!isRecord(value) || value['status'] !== 'ready') throw new Error('Invalid setup response');
  const hydra = value['hydra'];
  const startupCommand = value['startupCommand'];
  const repository = value['repository'];
  if (
    (hydra !== 'connected' && hydra !== 'unavailable') ||
    typeof startupCommand !== 'string' ||
    !isRecord(repository)
  ) {
    throw new Error('Invalid setup response');
  }
  const state = repository['state'];
  if (!isRepositoryState(state)) throw new Error('Invalid repository setup state');
  return {
    status: 'ready',
    hydra,
    startupCommand,
    repository: {
      state,
      id: nullableString(repository['id']),
      path: nullableString(repository['path']),
      indexedCommit: nullableString(repository['indexedCommit']),
      statistics: numberRecordOrNull(repository['statistics']),
      message: requiredString(repository['message']),
    },
  };
}

function isRepositoryState(value: unknown): value is RepositorySetupState {
  return (
    value === 'not_configured' ||
    value === 'misconfigured' ||
    value === 'not_indexed' ||
    value === 'indexed' ||
    value === 'context_unavailable'
  );
}

function numberRecordOrNull(value: unknown): Readonly<Record<string, number>> | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'number')) {
    throw new Error('Invalid repository statistics');
  }
  return value as Readonly<Record<string, number>>;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
