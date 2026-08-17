import { CommandBlock } from '../components/command-block.js';
import { ProofPath } from '../components/proof-path.js';
import {
  type EvaluationCase,
  type EvaluationClassification,
  type EvaluationLabel,
  type EvaluationResponse,
  useEvaluation,
} from '../data/evaluation.js';

export function EvaluationPage() {
  const { resource, refresh } = useEvaluation();

  return (
    <div className="document-page evaluation-page">
      <header className="document-header evaluation-header">
        <p className="document-index">03 / Evaluation</p>
        <h1>A graph should earn its place.</h1>
        <p>
          Every declared outcome runs through FreshContext and a direct-file baseline. The checked
          result includes authored edge cases, attributed public source, and a real MCP client
          receipt.
        </p>
      </header>

      {resource.state === 'loading' ? <EvaluationLoading /> : null}
      {resource.state === 'error' ? (
        <EvaluationError message={resource.message} refresh={refresh} />
      ) : null}
      {resource.state === 'ready' ? <EvaluationReady data={resource.data} /> : null}
    </div>
  );
}

function EvaluationLoading() {
  return (
    <div className="state-block loading-state evaluation-state" aria-live="polite">
      <span className="state-rule" aria-hidden="true" />
      <div>
        <strong>Verifying evaluation artifact</strong>
        <p>No metric appears until the local service validates the complete artifact.</p>
      </div>
    </div>
  );
}

function EvaluationError({
  message,
  refresh,
}: {
  readonly message: string;
  readonly refresh: () => void;
}) {
  return (
    <div className="state-block error-state evaluation-state" role="alert">
      <span className="state-rule" aria-hidden="true" />
      <div>
        <strong>Evaluation proof unavailable</strong>
        <p>{message}</p>
        <button className="button secondary compact-button" type="button" onClick={refresh}>
          Check again
        </button>
      </div>
    </div>
  );
}

function EvaluationReady({ data }: { readonly data: EvaluationResponse }) {
  const transitive = findLongestTruePositive(data);
  const boundaryMiss = data.cases
    .flatMap((entry) => entry.labels.map((label) => ({ caseId: entry.caseId, label })))
    .find(({ label }) => label.graph.classification === 'false_negative');
  const publicCase = data.cases.find(({ provenance }) => provenance !== null);

  return (
    <>
      <section className="evaluation-provenance" aria-labelledby="provenance-title">
        <div>
          <p className="technical-label" id="provenance-title">
            Proof source
          </p>
          <strong>Verified offline reference</strong>
          <p>
            Bundled output from the real pinned-Hydra run keeps this route reviewable without a
            network connection.
          </p>
        </div>
        <dl>
          <div>
            <dt>Evaluation id</dt>
            <dd>{data.evaluationId}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>{data.engine}</dd>
          </div>
          <div>
            <dt>Dataset</dt>
            <dd>
              {data.dataset.caseCount} real Git cases · {data.dataset.labelCount} labels
            </dd>
          </div>
          <div>
            <dt>Boundary</dt>
            <dd>{data.traversalBoundary}</dd>
          </div>
        </dl>
      </section>

      <section className="evaluation-score" aria-labelledby="score-title">
        <header className="section-rule">
          <span className="rule-mark" aria-hidden="true" />
          <h2 id="score-title">Same changes, same labels</h2>
        </header>
        <div className="score-ledger" role="table" aria-label="Evaluation result comparison">
          <div className="score-row score-heading" role="row">
            <span role="columnheader">Measure</span>
            <span role="columnheader">HydraDB call graph</span>
            <span role="columnheader">Direct-file baseline</span>
          </div>
          <ScoreRow
            label="Precision"
            graph={formatPercent(data.aggregate.graph.precision)}
            baseline={formatPercent(data.aggregate.directFileBaseline.precision)}
            featured
          />
          <ScoreRow
            label="Recall"
            graph={formatPercent(data.aggregate.graph.recall)}
            baseline={formatPercent(data.aggregate.directFileBaseline.recall)}
            featured
          />
          <ScoreRow
            label="False positives"
            graph={String(data.aggregate.graph.falsePositives)}
            baseline={String(data.aggregate.directFileBaseline.falsePositives)}
          />
          <ScoreRow
            label="False negatives"
            graph={String(data.aggregate.graph.falseNegatives)}
            baseline={String(data.aggregate.directFileBaseline.falseNegatives)}
          />
        </div>
        <p className="score-summary">
          Graph traversal caught {data.aggregate.graph.truePositives} of{' '}
          {data.aggregate.graph.truePositives + data.aggregate.graph.falseNegatives} affected
          memories with no false positives. Direct-file matching missed transitive callers and
          flagged unrelated symbols that shared a changed file.
        </p>
      </section>

      {publicCase?.provenance ? <PublicSourceProof entry={publicCase} /> : null}
      <McpReceipt receipt={data.mcpReceipt} />
      {transitive ? <TransitiveProof result={transitive} /> : null}
      {boundaryMiss ? (
        <BoundaryDisclosure caseId={boundaryMiss.caseId} label={boundaryMiss.label} />
      ) : null}

      <section className="evaluation-cases" aria-labelledby="cases-title">
        <header className="section-rule">
          <span className="rule-mark" aria-hidden="true" />
          <h2 id="cases-title">Review every label</h2>
        </header>
        {data.cases.map((entry) => (
          <CaseLedger key={entry.caseId} entry={entry} />
        ))}
      </section>

      <section className="evaluation-reproduce" aria-labelledby="reproduce-title">
        <div>
          <p className="technical-label" id="reproduce-title">
            Reproduce the proof
          </p>
          <h2>One command. A disposable graph. A new artifact.</h2>
          <p>
            The command creates real commits, runs the indexer and impact traversal, writes the JSON
            result atomically, then removes its isolated HydraDB volume.
          </p>
        </div>
        <CommandBlock command={data.command} />
      </section>

      <aside className="evaluation-caveat">
        <strong>Scope disclosure</strong>
        <p>
          This small fixed dataset is regression evidence for the V1 invalidation mechanism. It
          doesn&apos;t claim general performance across every TypeScript pattern.
        </p>
      </aside>
    </>
  );
}

function PublicSourceProof({ entry }: { readonly entry: EvaluationCase }) {
  const provenance = entry.provenance;
  if (!provenance) return null;
  const transitive = entry.labels
    .filter((label) => label.graph.classification === 'true_positive')
    .sort((left, right) => (right.graph.callHops ?? -1) - (left.graph.callHops ?? -1))[0];
  return (
    <section className="public-trace" aria-labelledby="public-trace-title">
      <div className="public-trace-copy">
        <p className="technical-label">Attributed public trace</p>
        <h2 id="public-trace-title">A real fix from the official MCP TypeScript SDK.</h2>
        <p>
          Exact source from two upstream commits proves that a guard change reaches notification
          callers in an unchanged server file. The bounded extract and upstream license ship with
          this evaluation.
        </p>
        <a href={provenance.url} target="_blank" rel="noreferrer">
          {provenance.repository}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div className="public-trace-proof">
        <dl>
          <div>
            <dt>Upstream change</dt>
            <dd>
              <a
                href={`${provenance.url}/commit/${provenance.afterCommit}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortSha(provenance.beforeCommit)} → {shortSha(provenance.afterCommit)}
              </a>
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{provenance.license}</dd>
          </div>
          <div>
            <dt>Bounded source</dt>
            <dd>{provenance.sourcePaths.length} exact files</dd>
          </div>
        </dl>
        {transitive?.graph.actualPath ? (
          <ProofPath
            steps={transitive.graph.actualPath.map((step) => ({
              name: step.qualifiedName,
              location: step.path,
            }))}
          />
        ) : null}
      </div>
    </section>
  );
}

function McpReceipt({ receipt }: { readonly receipt: EvaluationResponse['mcpReceipt'] }) {
  return (
    <section className="mcp-receipt" aria-labelledby="mcp-receipt-title">
      <header>
        <div>
          <p className="technical-label">Real protocol receipt</p>
          <h2 id="mcp-receipt-title">Same MCP recall. Safe before, withheld after.</h2>
          <p>
            The official SDK client called the production FreshContext tool on both commits. The
            second response returned no stale context and named the memory it withheld.
          </p>
        </div>
        <dl>
          <div>
            <dt>Client</dt>
            <dd>{receipt.client}</dd>
          </div>
          <div>
            <dt>Transport</dt>
            <dd>{receipt.transport}</dd>
          </div>
          <div>
            <dt>Tool</dt>
            <dd>{receipt.tool}</dd>
          </div>
        </dl>
      </header>
      <div className="receipt-input">
        <span>Exact symbol input</span>
        <code>
          {receipt.input.qualifiedName} · {receipt.input.path}
        </code>
      </div>
      <div className="receipt-results">
        <ReceiptState
          index="01"
          title="Context returned"
          commit={receipt.beforeChange.indexedCommit}
          memoryIds={receipt.beforeChange.returnedMemoryIds}
          detail="Current evidence-bound memory entered agent context."
        />
        <span className="receipt-transition" aria-hidden="true">
          committed change → HydraDB sync
        </span>
        <ReceiptState
          index="02"
          title="Agent abstained"
          commit={receipt.afterChange.indexedCommit}
          memoryIds={receipt.afterChange.withheldMemoryIds}
          detail="No stale memory returned · all_matching_memory_unsafe"
          withheld
        />
      </div>
    </section>
  );
}

function ReceiptState({
  index,
  title,
  commit,
  memoryIds,
  detail,
  withheld = false,
}: {
  readonly index: string;
  readonly title: string;
  readonly commit: string;
  readonly memoryIds: readonly string[];
  readonly detail: string;
  readonly withheld?: boolean;
}) {
  return (
    <article className={`receipt-state${withheld ? ' receipt-withheld' : ''}`}>
      <span>{index}</span>
      <div>
        <p className="technical-label">{shortSha(commit)}</p>
        <h3>{title}</h3>
        <p>{detail}</p>
        <code>{memoryIds.map(shortId).join(', ')}</code>
      </div>
    </article>
  );
}

function ScoreRow({
  label,
  graph,
  baseline,
  featured = false,
}: {
  readonly label: string;
  readonly graph: string;
  readonly baseline: string;
  readonly featured?: boolean;
}) {
  return (
    <div className={`score-row${featured ? ' score-featured' : ''}`} role="row">
      <span role="cell">{label}</span>
      <strong role="cell">{graph}</strong>
      <span role="cell">{baseline}</span>
    </div>
  );
}

function TransitiveProof({ result }: { readonly result: EvaluationLabel }) {
  return (
    <section className="evaluation-transitive" aria-labelledby="transitive-title">
      <div>
        <p className="technical-label">Graph-native proof</p>
        <h2 id="transitive-title">
          The file baseline missed this {result.graph.callHops}-hop caller.
        </h2>
        <p>{result.claim}</p>
      </div>
      {result.graph.actualPath ? (
        <ProofPath
          steps={result.graph.actualPath.map((step) => ({
            name: step.qualifiedName,
            location: step.path,
          }))}
        />
      ) : null}
    </section>
  );
}

function BoundaryDisclosure({
  caseId,
  label,
}: {
  readonly caseId: string;
  readonly label: EvaluationLabel;
}) {
  return (
    <aside className="boundary-disclosure">
      <span className="boundary-mark" aria-hidden="true" />
      <div>
        <p className="technical-label">Visible limit · {caseId}</p>
        <strong>One expected impact remains missed beyond the V1 boundary.</strong>
        <p>
          {label.claim}. The required path is four reverse call hops, while V1 deliberately stops at
          three. The false negative stays in the score.
        </p>
      </div>
    </aside>
  );
}

function CaseLedger({ entry }: { readonly entry: EvaluationCase }) {
  return (
    <article className="case-ledger">
      <header>
        <div>
          <p className="technical-label">{entry.caseId}</p>
          <h3>{entry.description}</h3>
          <p>{entry.changeSummary}</p>
          {entry.provenance ? (
            <p className="case-source">
              Public source ·{' '}
              <a href={entry.provenance.url} target="_blank" rel="noreferrer">
                {entry.provenance.repository}
              </a>
            </p>
          ) : null}
        </div>
        <dl>
          <div>
            <dt>Labels</dt>
            <dd>{entry.labelCount}</dd>
          </div>
          <div>
            <dt>Changed symbols</dt>
            <dd>{entry.changedSymbolCount}</dd>
          </div>
          <div>
            <dt>{entry.provenance ? 'Outside extract' : 'Unresolved calls'}</dt>
            <dd>{entry.unresolvedCallCount}</dd>
          </div>
        </dl>
      </header>
      <div className="label-ledger" role="table" aria-label={`${entry.caseId} evaluation labels`}>
        <div className="label-row label-heading" role="row">
          <span role="columnheader">Expected claim</span>
          <span role="columnheader">Graph result</span>
          <span role="columnheader">File result</span>
        </div>
        {entry.labels.map((label) => (
          <div className="label-row" role="row" key={label.id}>
            <span role="cell">
              <strong>{label.claim}</strong>
              <code>
                {label.evidence.qualifiedName} · {label.evidence.path}
              </code>
            </span>
            <span role="cell" className={`classification ${label.graph.classification}`}>
              {formatClassification(label.graph.classification)}
              {label.graph.callHops !== null ? ` · ${label.graph.callHops} hops` : ''}
            </span>
            <span
              role="cell"
              className={`classification ${label.directFileBaseline.classification}`}
            >
              {formatClassification(label.directFileBaseline.classification)}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function findLongestTruePositive(data: EvaluationResponse): EvaluationLabel | null {
  return (
    data.cases
      .flatMap((entry) => entry.labels)
      .filter(
        (label) => label.graph.classification === 'true_positive' && label.graph.callHops !== null,
      )
      .sort((left, right) => (right.graph.callHops ?? -1) - (left.graph.callHops ?? -1))[0] ?? null
  );
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatClassification(value: EvaluationClassification): string {
  return value.replaceAll('_', ' ');
}

function shortSha(value: string): string {
  return value.slice(0, 8);
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
}
