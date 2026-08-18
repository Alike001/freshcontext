import { CommandBlock } from '../components/command-block.js';
import { useSetup } from '../data/setup.js';

export function SetupPage() {
  const { resource, refresh, indexRepository, synchronizeRepository } = useSetup();

  return (
    <div className="document-page setup-page">
      <header className="document-header">
        <p className="document-index">04 / Setup</p>
        <h1>Local runtime, clearly accounted for.</h1>
        <p>
          FreshContext runs against the pinned HydraDB OSS engine. This page reports what the local
          service can verify now.
        </p>
      </header>

      <section className="runbook-section" aria-labelledby="startup-heading">
        <h2 id="startup-heading">Start the stack</h2>
        <CommandBlock
          command={
            resource.state === 'ready' ? resource.data.startupCommand : 'docker compose up --wait'
          }
        />
      </section>

      <section className="setup-status" aria-labelledby="status-heading" aria-live="polite">
        <div className="setup-heading-row">
          <h2 id="status-heading">Verified state</h2>
          <button className="button secondary compact-button" type="button" onClick={refresh}>
            Check again
          </button>
        </div>
        {resource.state === 'loading' ? <SetupLoading /> : null}
        {resource.state === 'error' ? <SetupError message={resource.message} /> : null}
        {resource.state === 'ready' ? (
          <SetupReady
            data={resource.data}
            onIndex={indexRepository}
            onSynchronize={synchronizeRepository}
          />
        ) : null}
      </section>

      <section className="runbook-section" aria-labelledby="next-heading">
        <h2 id="next-heading">Next valid action</h2>
        <p>{nextAction(resource)}</p>
      </section>
    </div>
  );
}

function SetupLoading() {
  return (
    <div className="state-block loading-state">
      <span className="state-rule" aria-hidden="true" />
      <div>
        <strong>Checking local services</strong>
        <p>Waiting for the FreshContext service to report HydraDB and repository state.</p>
      </div>
    </div>
  );
}

function SetupError({ message }: { readonly message: string }) {
  return (
    <div className="state-block error-state" role="alert">
      <span className="state-rule" aria-hidden="true" />
      <div>
        <strong>FreshContext service unavailable</strong>
        <p>{message}</p>
        <code>docker compose logs freshcontext hydra</code>
      </div>
    </div>
  );
}

function SetupReady({
  data,
  onIndex,
  onSynchronize,
}: {
  readonly data: import('../data/setup.js').SetupResponse;
  readonly onIndex: () => Promise<void>;
  readonly onSynchronize: () => Promise<void>;
}) {
  const state = data.repository.state;
  const configured = data.repository.source === 'configured';
  return (
    <>
      <dl className="status-ledger">
        <div>
          <dt>HydraDB OSS</dt>
          <dd className={data.hydra === 'connected' ? 'status-good' : 'status-bad'}>
            {data.hydra === 'connected' ? 'Connected and verified' : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd>{formatRepositoryState(state)}</dd>
        </div>
        <div>
          <dt>Data source</dt>
          <dd>
            {data.repository.source === 'example'
              ? 'Example data, processed through the real stack'
              : configured
                ? 'Configured local repository'
                : 'None selected'}
          </dd>
        </div>
        <div>
          <dt>Repository id</dt>
          <dd>{data.repository.id ?? 'None selected'}</dd>
        </div>
        <div>
          <dt>Local path</dt>
          <dd>{data.repository.path ?? 'None selected'}</dd>
        </div>
        <div>
          <dt>Indexed commit</dt>
          <dd>{data.repository.indexedCommit ?? 'No completed index'}</dd>
        </div>
        {data.repository.statistics ? (
          <div>
            <dt>Index quality</dt>
            <dd>{formatIndexQuality(data.repository.statistics)}</dd>
          </div>
        ) : null}
        <div className="ledger-message">
          <dt>What this means</dt>
          <dd>{data.repository.message}</dd>
        </div>
      </dl>
      {configured ? (
        <div className="repository-actions" aria-label="Configured repository actions">
          {state === 'not_indexed' || state === 'invalid_repository' ? (
            <button className="button primary" type="button" onClick={() => void onIndex()}>
              {state === 'invalid_repository' ? 'Retry repository index' : 'Index repository'}
            </button>
          ) : null}
          {state === 'indexed' ? (
            <button className="button primary" type="button" onClick={() => void onSynchronize()}>
              Sync committed changes
            </button>
          ) : null}
          {state === 'indexing' || state === 'syncing' ? (
            <button className="button primary" type="button" disabled>
              {state === 'indexing' ? 'Indexing repository…' : 'Syncing repository…'}
            </button>
          ) : null}
          <p>Only the read-only repository selected at startup can be indexed or synchronized.</p>
        </div>
      ) : null}
    </>
  );
}

function formatRepositoryState(state: import('../data/setup.js').RepositorySetupState): string {
  switch (state) {
    case 'indexed':
      return 'Indexed';
    case 'not_indexed':
      return 'Selected, waiting for an index';
    case 'indexing':
      return 'Indexing through Git and HydraDB';
    case 'syncing':
      return 'Synchronizing committed changes';
    case 'invalid_repository':
      return 'Repository validation failed';
    case 'misconfigured':
      return 'Configuration incomplete';
    case 'context_unavailable':
      return 'State unavailable';
    case 'not_configured':
      return 'Not configured';
  }
}

function formatIndexQuality(statistics: Readonly<Record<string, number>>): string {
  const files = statistics['indexedFileCount'] ?? 0;
  const skipped = statistics['skippedFileCount'] ?? 0;
  const diagnostics = statistics['syntacticDiagnosticCount'] ?? 0;
  const calls = statistics['callEdgeCount'] ?? 0;
  const imports = statistics['importEdgeCount'] ?? 0;
  return `${files} files, ${calls} calls, ${imports} imports, ${skipped} skipped, ${diagnostics} syntax diagnostics`;
}

function nextAction(resource: ReturnType<typeof useSetup>['resource']): string {
  if (resource.state !== 'ready') {
    return 'Keep the stack running while FreshContext verifies the local services.';
  }
  const { repository } = resource.data;
  if (repository.state === 'indexed') {
    return repository.source === 'configured'
      ? 'Open the Proof Console, or synchronize again after committing a code change.'
      : 'Open the Proof Console to inspect evidence-bound memory for the selected commit.';
  }
  if (repository.state === 'not_indexed') {
    return 'Index the selected repository. FreshContext will accept only its clean committed TypeScript state.';
  }
  if (repository.state === 'invalid_repository') {
    return 'Correct the reported repository problem, then retry the index.';
  }
  if (repository.state === 'indexing' || repository.state === 'syncing') {
    return 'Keep this page open. FreshContext will publish the new state only after HydraDB verification.';
  }
  return 'Repository connection and indexing must complete before the Proof Console can show live memory.';
}
