import { Link } from 'react-router';

import { CommandBlock } from '../components/command-block.js';
import { ProofPath } from '../components/proof-path.js';
import { useSetup } from '../data/setup.js';

const examplePath = [
  { name: 'fee()', location: 'src/pricing.ts' },
  { name: 'calculateTotal()', location: 'src/pricing.ts' },
  { name: 'Checkout.total()', location: 'src/checkout.ts' },
  { name: 'Memory', location: 'evidence-bound claim' },
] as const;

export function OverviewPage() {
  const { resource } = useSetup();
  const startupCommand =
    resource.state === 'ready' ? resource.data.startupCommand : 'docker compose up --build --wait';

  return (
    <div className="overview-page">
      <section className="hero-section">
        <div className="hero-copy">
          <h1>
            Your agent remembers.
            <br />
            Your code moved on.
          </h1>
          <p>
            FreshContext proves which memories became unsafe after a committed code change, then
            withholds them before they reach your coding agent.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/console">
              Open Proof Console
            </Link>
            <Link className="text-action" to="/evaluation">
              View evaluation
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="built-on">Built on HydraDB OSS</p>
        </div>
        <article className="proof-dossier" aria-labelledby="proof-dossier-title">
          <header className="section-rule compact">
            <span className="rule-mark" aria-hidden="true" />
            <h2 id="proof-dossier-title">Proof dossier</h2>
            <span className="example-label">Example data</span>
          </header>
          <div className="dossier-grid">
            <div className="dossier-claim">
              <span className="technical-label">Memory claim</span>
              <p>Checkout total includes the fee through calculateTotal.</p>
            </div>
            <div className="dossier-change">
              <span className="technical-label">Committed change</span>
              <strong>fee()</strong>
              <code>pricing fixture</code>
            </div>
            <div className="dossier-path">
              <span className="technical-label">HydraDB path, ordered</span>
              <ProofPath steps={examplePath} />
            </div>
            <div className="dossier-result">
              <span className="technical-label">Result</span>
              <strong>Withheld</strong>
              <p>Unsafe memory stays out of active recall.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="why-section content-section" aria-labelledby="why-title">
        <header className="section-rule">
          <span className="rule-mark" aria-hidden="true" />
          <h2 id="why-title">Why a graph?</h2>
        </header>
        <div className="comparison-layout">
          <article className="comparison direct">
            <h3>Direct file matching</h3>
            <div className="mini-path" aria-label="Direct file matching misses an indirect memory">
              <span>Changed file</span>
              <span className="broken-connector">misses</span>
              <span>Memory</span>
            </div>
            <p>A file-only check misses behavior reached through callers in other modules.</p>
          </article>
          <article className="comparison graph">
            <h3>HydraDB call path</h3>
            <div
              className="mini-path"
              aria-label="Graph traversal connects a changed function to memory"
            >
              <span>Changed symbol</span>
              <span className="solid-connector">calls</span>
              <span>Caller</span>
              <span className="solid-connector">supports</span>
              <span>Memory</span>
            </div>
            <p>
              The stored call path proves the dependency and preserves the shortest explanation.
            </p>
          </article>
        </div>
      </section>

      <section className="loop-section content-section" aria-labelledby="loop-title">
        <header className="section-rule">
          <span className="rule-mark" aria-hidden="true" />
          <h2 id="loop-title">A safe memory loop</h2>
        </header>
        <ol className="lifecycle-strip">
          <li>
            <span>Remember</span>
            <p>Bind a claim to exact code evidence.</p>
          </li>
          <li>
            <span>Detect</span>
            <p>Compare the next committed symbol graph.</p>
          </li>
          <li>
            <span>Withhold</span>
            <p>Keep affected memory out of active recall.</p>
          </li>
          <li>
            <span>Review</span>
            <p>Replace the claim without deleting its history.</p>
          </li>
        </ol>
      </section>

      <section className="start-section content-section" aria-labelledby="start-title">
        <div>
          <header className="section-rule">
            <span className="rule-mark" aria-hidden="true" />
            <h2 id="start-title">Run the real stack</h2>
          </header>
          <p>One command starts FreshContext and the pinned HydraDB OSS runtime locally.</p>
        </div>
        <div>
          <CommandBlock command={startupCommand} />
          <Link className="text-action" to="/setup">
            Open setup details
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <span>FreshContext · MIT licensed</span>
        <nav aria-label="Project links">
          <a href="https://github.com/Alike001/freshcontext">GitHub</a>
          <a href="https://github.com/hydra-db/hydradb">HydraDB OSS</a>
        </nav>
      </footer>
    </div>
  );
}
