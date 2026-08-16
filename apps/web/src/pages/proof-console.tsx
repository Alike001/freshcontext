import { Link } from 'react-router';

import { useSetup } from '../data/setup.js';

export function ProofConsolePage() {
  const { resource } = useSetup();
  const repositoryReady =
    resource.state === 'ready' && resource.data.repository.state === 'indexed';

  return (
    <div className="empty-product-page">
      <div className="empty-product-index">
        <span>Review index</span>
        <strong>{repositoryReady ? 'No affected memory' : 'No repository'}</strong>
      </div>
      <section className="empty-product-main" aria-labelledby="console-title">
        <p className="document-index">02 / Proof Console</p>
        <h1 id="console-title">
          {repositoryReady ? 'No memory needs review.' : 'Connect a real repository first.'}
        </h1>
        <p>
          {repositoryReady
            ? 'The selected commit has no affected memory to inspect.'
            : 'The console stays empty until FreshContext can verify an indexed commit in HydraDB.'}
        </p>
        <Link className="button primary" to="/setup">
          Open Setup
        </Link>
      </section>
      <aside className="empty-product-rail" aria-label="Chronology">
        <span>Chronology</span>
        <p>No lifecycle events to show.</p>
      </aside>
    </div>
  );
}
