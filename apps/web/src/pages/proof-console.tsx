import { useEffect, useState, type FormEvent } from 'react';

import { ProofPath } from '../components/proof-path.js';
import {
  fetchConsole,
  reviewMemory,
  type ConsoleEvent,
  type ConsoleMemory,
  type ConsoleResponse,
} from '../data/console.js';

type ConsoleResource =
  | { readonly state: 'loading'; readonly data: null; readonly message: string }
  | { readonly state: 'ready'; readonly data: ConsoleResponse; readonly message: string }
  | { readonly state: 'error'; readonly data: null; readonly message: string };

export function ProofConsolePage() {
  const [resource, setResource] = useState<ConsoleResource>({
    state: 'loading',
    data: null,
    message: 'Reading memory and impact proofs from HydraDB.',
  });
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, []);

  async function load(memoryId?: string, signal?: AbortSignal) {
    setResource({ state: 'loading', data: null, message: 'Reading verified graph state.' });
    try {
      const data = await fetchConsole(memoryId, signal);
      if (!signal?.aborted) setResource({ state: 'ready', data, message: 'Graph state verified.' });
    } catch (error) {
      if (signal?.aborted) return;
      setResource({
        state: 'error',
        data: null,
        message: error instanceof Error ? error.message : 'The Proof Console is unavailable.',
      });
    }
  }

  async function submitReview(memoryId: string, replacementClaim: string) {
    setReviewing(true);
    setReviewError(null);
    try {
      const data = await reviewMemory(memoryId, replacementClaim);
      setResource({ state: 'ready', data, message: 'Replacement verified in HydraDB.' });
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Review failed safely.');
    } finally {
      setReviewing(false);
    }
  }

  if (resource.state === 'loading') {
    return <ConsoleState title="Verifying the proof path." message={resource.message} />;
  }
  if (resource.state === 'error') {
    return (
      <ConsoleState
        title="Proof Console unavailable."
        message={`${resource.message} No cached claim was shown.`}
        error
        onRetry={() => void load()}
      />
    );
  }
  const data = resource.data;
  const dossier = data.selected;
  if (!dossier) {
    return (
      <ConsoleState
        title="No memory recorded."
        message="This repository has no evidence-bound memory."
      />
    );
  }
  return (
    <div className="console-page">
      <aside className="review-index" aria-label="Review index">
        <header>
          <p className="document-index">Review index</p>
          <strong>
            {data.memories.filter((memory) => memory.state === 'needs_review').length} open
          </strong>
          <span>{data.source === 'example' ? 'Example data' : 'Configured repository'}</span>
        </header>
        <ol>
          {data.memories.map((memory, index) => (
            <li key={memory.memoryId}>
              <button
                className={memory.memoryId === dossier.memory.memoryId ? 'selected' : ''}
                type="button"
                onClick={() => void load(memory.memoryId)}
                aria-current={memory.memoryId === dossier.memory.memoryId ? 'true' : undefined}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{memory.claim}</strong>
                <small>{formatState(memory.state)}</small>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="console-dossier" aria-labelledby="proof-console-title">
        <header className="console-heading">
          <div>
            <p className="document-index">02 / Proof Console</p>
            <p className={`console-status status-${dossier.memory.state}`}>
              {formatState(dossier.memory.state)}
            </p>
          </div>
          <h1 id="proof-console-title">{dossier.memory.claim}</h1>
          <dl>
            <div>
              <dt>Evidence</dt>
              <dd>{formatEvidence(dossier.memory)}</dd>
            </div>
            <div>
              <dt>Source commit</dt>
              <dd>{shortSha(dossier.memory.sourceCommit)}</dd>
            </div>
          </dl>
        </header>

        {dossier.impact ? (
          <section className="console-proof" aria-labelledby="path-heading">
            <div className="console-section-heading">
              <div>
                <p className="technical-label">HydraDB impact proof</p>
                <h2 id="path-heading">Why this claim was withheld</h2>
              </div>
              <span>{dossier.impact.callHops} reverse call hops</span>
            </div>
            <ProofPath
              steps={dossier.impact.steps.map((step) => ({
                name: step.qualifiedName ?? 'Stored memory',
                location: step.path ?? 'Evidence-bound claim',
              }))}
            />
          </section>
        ) : (
          <section className="console-proof no-impact">
            <p className="technical-label">No active impact proof</p>
            <p>This memory is not currently withheld by a synchronized code change.</p>
          </section>
        )}

        {dossier.diff ? (
          <section className="console-diff" aria-labelledby="diff-heading">
            <div className="console-section-heading">
              <div>
                <p className="technical-label">Verified Git change</p>
                <h2 id="diff-heading">{dossier.impact?.change.symbolKey}</h2>
              </div>
              <span>
                {shortSha(dossier.impact?.change.fromCommit ?? '')} →{' '}
                {shortSha(dossier.impact?.change.toCommit ?? '')}
              </span>
            </div>
            <pre aria-label="Code change">
              <code>{dossier.diff}</code>
            </pre>
          </section>
        ) : null}

        <ReviewPanel
          key={dossier.memory.memoryId}
          memory={dossier.memory}
          replacement={dossier.replacement}
          source={data.source}
          reviewing={reviewing}
          error={reviewError}
          onReview={submitReview}
        />
      </main>

      <aside className="chronology-rail" aria-label="Memory chronology">
        <header>
          <p className="document-index">Chronology</p>
          <strong>Immutable events</strong>
        </header>
        <ol>
          {dossier.chronology.map((event) => (
            <li key={`${event.eventType}:${event.commitSha}`}>
              <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
              <strong>{formatEvent(event.eventType)}</strong>
              <code>{shortSha(event.commitSha)}</code>
            </li>
          ))}
        </ol>
      </aside>

      <footer className="console-footer">
        <span>{data.repositoryLabel}</span>
        <span>Commit {shortSha(data.selectedCommit)}</span>
        <span>HydraDB OSS · verified</span>
        <span>{data.source === 'example' ? 'Example data' : 'Local repository'}</span>
      </footer>
    </div>
  );
}

function ReviewPanel({
  memory,
  replacement,
  source,
  reviewing,
  error,
  onReview,
}: {
  readonly memory: ConsoleMemory;
  readonly replacement: ConsoleMemory | null;
  readonly source: ConsoleResponse['source'];
  readonly reviewing: boolean;
  readonly error: string | null;
  readonly onReview: (memoryId: string, replacementClaim: string) => Promise<void>;
}) {
  const suggestion =
    source === 'example'
      ? 'Checkout totals use the tiered service fee through calculateTotal.'
      : '';
  const [claim, setClaim] = useState(suggestion);

  if (replacement) {
    return (
      <section className="review-complete" aria-live="polite">
        <p className="technical-label">Supersession verified</p>
        <h2>The old claim stays in history.</h2>
        <blockquote>{replacement.claim}</blockquote>
        <p>The replacement is current. Recall will continue to withhold the superseded original.</p>
      </section>
    );
  }
  if (memory.state !== 'needs_review') return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = claim.trim();
    if (normalized.length > 0) void onReview(memory.memoryId, normalized);
  }

  return (
    <section className="review-panel" aria-labelledby="review-heading">
      <div>
        <p className="technical-label">Human review</p>
        <h2 id="review-heading">Replace the stale claim without erasing it.</h2>
        <p>The new statement must stay bound to the same evidence symbol at the selected commit.</p>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="replacement-claim">Replacement claim</label>
        <textarea
          id="replacement-claim"
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          maxLength={2000}
          required
          rows={4}
        />
        {error ? (
          <p className="review-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button primary"
          type="submit"
          disabled={reviewing || claim.trim().length === 0}
        >
          {reviewing ? 'Verifying replacement…' : 'Supersede claim'}
        </button>
      </form>
    </section>
  );
}

function ConsoleState({
  title,
  message,
  error = false,
  onRetry,
}: {
  readonly title: string;
  readonly message: string;
  readonly error?: boolean;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="empty-product-page">
      <div className="empty-product-index">
        <span>Review index</span>
        <strong>Waiting for verified state</strong>
      </div>
      <section className="empty-product-main" role={error ? 'alert' : undefined}>
        <p className="document-index">02 / Proof Console</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {onRetry ? (
          <button className="button primary" type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </section>
      <aside className="empty-product-rail">
        <span>Chronology</span>
        <p>No unverified events shown.</p>
      </aside>
    </div>
  );
}

function formatState(state: ConsoleMemory['state']): string {
  return state === 'needs_review' ? 'Needs review' : state.replace('_', ' ');
}

function formatEvidence(memory: ConsoleMemory): string {
  const first = memory.evidence[0];
  return first ? `${first.path} · ${first.qualifiedName}` : 'No evidence';
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatEvent(event: ConsoleEvent['eventType']): string {
  switch (event) {
    case 'created':
      return 'Claim stored';
    case 'invalidated':
      return 'Impact detected';
    case 'superseded':
      return 'Original superseded';
    case 'reviewed-replacement':
      return 'Replacement current';
  }
}
