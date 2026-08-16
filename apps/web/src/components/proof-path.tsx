export interface ProofStep {
  readonly name: string;
  readonly location: string;
}

export function ProofPath({ steps }: { readonly steps: readonly ProofStep[] }) {
  return (
    <ol className="proof-path" aria-label="Ordered HydraDB evidence path">
      {steps.map((step, index) => (
        <li key={`${step.location}:${step.name}`}>
          <div className="proof-node">
            <strong>{step.name}</strong>
            <span>{step.location}</span>
          </div>
          {index < steps.length - 1 ? (
            <svg className="path-arrow" viewBox="0 0 48 12" aria-hidden="true">
              <path d="M0 6h41" />
              <path d="m36 1 6 5-6 5" />
            </svg>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
