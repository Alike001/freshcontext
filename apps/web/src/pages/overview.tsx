import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { CommandBlock } from '../components/command-block.js';
import { ProofPath, type ProofStep } from '../components/proof-path.js';
import { fetchConsole, type ConsoleResponse, type MemoryState } from '../data/console.js';
import { useSetup } from '../data/setup.js';

type ProofResource =
  | { readonly state: 'loading'; readonly data: null }
  | { readonly state: 'ready'; readonly data: ConsoleResponse }
  | { readonly state: 'error'; readonly data: null };

export function OverviewPage() {
  const { resource } = useSetup();
  const [proof, setProof] = useState<ProofResource>({ state: 'loading', data: null });
  const startupCommand =
    resource.state === 'ready' ? resource.data.startupCommand : 'docker compose up --build --wait';
  const dossier = proof.state === 'ready' ? proof.data.selected : null;

  useEffect(() => {
    const controller = new AbortController();
    void fetchConsole(undefined, controller.signal)
      .then((data) => setProof({ state: 'ready', data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setProof({ state: 'error', data: null });
      });
    return () => controller.abort();
  }, []);

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
            <span className="example-label">
              {proof.state === 'ready'
                ? proof.data.source === 'example'
                  ? 'Verified example'
                  : 'Configured repository'
                : 'Live verification'}
            </span>
          </header>
          {proof.state === 'loading' ? (
            <OverviewProofStatus
              title="Verifying HydraDB proof"
              detail="Reading the active graph."
            />
          ) : proof.state === 'error' ? (
            <OverviewProofStatus
              title="Live proof unavailable"
              detail="Open the Proof Console to retry the verified read."
            />
          ) : dossier ? (
            <div className="dossier-grid">
              <div className="dossier-claim">
                <span className="technical-label">Memory claim</span>
                <p>{dossier.memory.claim}</p>
              </div>
              <div className="dossier-change">
                <span className="technical-label">
                  {dossier.impact ? 'Committed change' : 'Selected evidence'}
                </span>
                <strong>{proofSubjectName(dossier)}</strong>
                <code>{proofSubjectLocation(dossier)}</code>
              </div>
              <div className="dossier-path">
                <span className="technical-label">HydraDB path, ordered</span>
                {dossier.impact ? (
                  <ProofPath steps={proofSteps(dossier.impact.steps)} />
                ) : (
                  <p>No invalidation path applies to this current memory.</p>
                )}
              </div>
              <div className="dossier-result">
                <span className="technical-label">Result</span>
                <strong>{resultLabel(dossier.memory.state)}</strong>
                <p>{resultDetail(dossier.memory.state)}</p>
              </div>
            </div>
          ) : (
            <OverviewProofStatus
              title="No memory indexed yet"
              detail="Open Setup to index a repository and create evidence-bound memory."
            />
          )}
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

function OverviewProofStatus({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="dossier-grid" role="status">
      <div className="dossier-claim">
        <span className="technical-label">Proof state</span>
        <p>{title}</p>
      </div>
      <div className="dossier-result">
        <span className="technical-label">Detail</span>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function proofSteps(
  steps: NonNullable<NonNullable<ConsoleResponse['selected']>['impact']>['steps'],
): ProofStep[] {
  return steps.map((step) => ({
    name: step.nodeKind === 'Memory' ? 'Memory' : (step.qualifiedName ?? 'Unknown symbol'),
    location: step.nodeKind === 'Memory' ? 'evidence-bound claim' : (step.path ?? 'unknown path'),
  }));
}

function proofSubjectName(dossier: NonNullable<ConsoleResponse['selected']>): string {
  const symbolKey = dossier.impact?.change.symbolKey;
  if (symbolKey) return symbolKey.split('::').at(-1) ?? symbolKey;
  return dossier.memory.evidence[0]?.qualifiedName ?? 'No evidence symbol';
}

function proofSubjectLocation(dossier: NonNullable<ConsoleResponse['selected']>): string {
  const symbolKey = dossier.impact?.change.symbolKey;
  return symbolKey?.split('::')[0] ?? dossier.memory.evidence[0]?.path ?? 'No evidence path';
}

function resultLabel(state: MemoryState): string {
  if (state === 'needs_review') return 'Withheld';
  if (state === 'superseded') return 'Superseded';
  if (state === 'current') return 'Current';
  return 'Pending';
}

function resultDetail(state: MemoryState): string {
  if (state === 'needs_review') return 'Unsafe memory stays out of active recall.';
  if (state === 'superseded') return 'The replacement remains active and the history stays intact.';
  if (state === 'current') return 'The claim is safe to return at the selected commit.';
  return 'The claim remains unavailable until its evidence is verified.';
}
