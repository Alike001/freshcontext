import { CommandBlock } from '../components/command-block.js';

export function EvaluationPage() {
  return (
    <div className="document-page evaluation-page">
      <header className="document-header">
        <p className="document-index">03 / Evaluation</p>
        <h1>Result quality should be rerunnable.</h1>
        <p>
          The Evaluation route will read the latest local JSON artifact. Until that artifact is
          connected to this route, FreshContext shows no benchmark numbers here.
        </p>
      </header>
      <section className="runbook-section" aria-labelledby="evaluation-command">
        <h2 id="evaluation-command">Generate the real artifact</h2>
        <CommandBlock command="pnpm evaluate" />
      </section>
      <div className="state-block empty-state">
        <span className="state-rule" aria-hidden="true" />
        <div>
          <strong>No evaluation artifact loaded</strong>
          <p>Run the command above. Placeholder scores are deliberately excluded.</p>
        </div>
      </div>
    </div>
  );
}
