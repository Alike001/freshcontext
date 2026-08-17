import { CommandBlock } from '../components/command-block.js';
import { useSetup } from '../data/setup.js';

export function SetupPage() {
  const { resource, refresh } = useSetup();

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
            resource.state === 'ready'
              ? resource.data.startupCommand
              : 'docker compose up --build --wait'
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
        {resource.state === 'ready' ? <SetupReady data={resource.data} /> : null}
      </section>

      <section className="runbook-section" aria-labelledby="next-heading">
        <h2 id="next-heading">Next valid action</h2>
        <p>
          {resource.state === 'ready' && resource.data.repository.state === 'indexed'
            ? 'Open the Proof Console to inspect evidence-bound memory for the selected commit.'
            : 'Keep the stack running. Repository connection and indexing must complete before the Proof Console can show live memory.'}
        </p>
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

function SetupReady({ data }: { readonly data: import('../data/setup.js').SetupResponse }) {
  return (
    <dl className="status-ledger">
      <div>
        <dt>HydraDB OSS</dt>
        <dd className={data.hydra === 'connected' ? 'status-good' : 'status-bad'}>
          {data.hydra === 'connected' ? 'Connected and verified' : 'Unavailable'}
        </dd>
      </div>
      <div>
        <dt>Repository</dt>
        <dd>{formatRepositoryState(data.repository.state)}</dd>
      </div>
      <div>
        <dt>Data source</dt>
        <dd>
          {data.repository.source === 'example'
            ? 'Example data, processed through the real stack'
            : data.repository.source === 'configured'
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
      <div className="ledger-message">
        <dt>What this means</dt>
        <dd>{data.repository.message}</dd>
      </div>
    </dl>
  );
}

function formatRepositoryState(state: import('../data/setup.js').RepositorySetupState): string {
  switch (state) {
    case 'indexed':
      return 'Indexed';
    case 'not_indexed':
      return 'Selected, waiting for an index';
    case 'misconfigured':
      return 'Configuration incomplete';
    case 'context_unavailable':
      return 'State unavailable';
    case 'not_configured':
      return 'Not configured';
  }
}
