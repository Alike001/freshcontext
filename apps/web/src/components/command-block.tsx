import { useState } from 'react';

export function CommandBlock({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="command-block">
      <code>{command}</code>
      <button type="button" onClick={() => void copyCommand()} aria-live="polite">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
