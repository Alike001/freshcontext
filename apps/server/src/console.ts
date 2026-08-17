import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  MemoryDomainError,
  type ConsoleService,
  type ConsoleReadResult,
  type ReviewService,
  type ReviewMemoryResult,
  type SafeStatusResult,
} from '@freshcontext/core';

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;

export interface ProductConsoleResponse extends ConsoleReadResult {
  readonly status: 'ready';
  readonly source: 'example' | 'configured';
  readonly repositoryLabel: string;
  readonly selected: ProductConsoleDossier | null;
}

export type ProductConsoleDossier = NonNullable<ConsoleReadResult['selected']> & {
  readonly diff: string | null;
};

export interface ProductConsoleOptions {
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly source: 'example' | 'configured';
  readonly console: ConsoleService;
  readonly review: ReviewService;
  readonly statusGateway: {
    status(input: { readonly repositoryId: string }): Promise<SafeStatusResult>;
  };
}

export class ProductConsoleGateway {
  readonly #options: ProductConsoleOptions;

  public constructor(options: ProductConsoleOptions) {
    this.#options = options;
  }

  public async read(memoryId?: string): Promise<ProductConsoleResponse> {
    const selectedCommit = await this.#selectedCommit();
    const result = await this.#options.console.read({
      repositoryId: this.#options.repositoryId,
      selectedCommit,
      ...(memoryId ? { memoryId } : {}),
    });
    return this.#enrich(result);
  }

  public async review(memoryId: string, replacementClaim: string): Promise<ProductConsoleResponse> {
    const selectedCommit = await this.#selectedCommit();
    const current = await this.#options.console.read({
      repositoryId: this.#options.repositoryId,
      selectedCommit,
      memoryId,
    });
    const selected = current.selected;
    if (!selected || selected.memory.state !== 'needs_review') {
      throw new MemoryDomainError('MEMORY_NOT_RETRYABLE', 'Memory must need review');
    }
    const result: ReviewMemoryResult = await this.#options.review.review({
      repositoryId: this.#options.repositoryId,
      originalMemoryId: memoryId,
      commitSha: selectedCommit,
      replacementClaim,
      evidence: selected.memory.evidence,
    });
    if (result.original.memoryId !== memoryId) {
      throw new MemoryDomainError('CORRUPT_GRAPH', 'Review returned a different original memory');
    }
    return this.read(memoryId);
  }

  async #selectedCommit(): Promise<string> {
    const status = await this.#options.statusGateway.status({
      repositoryId: this.#options.repositoryId,
    });
    if (status.status !== 'ready' || !status.indexed || !status.indexedCommit) {
      throw new Error('The configured repository does not have a readable selected commit.');
    }
    return status.indexedCommit;
  }

  async #enrich(result: ConsoleReadResult): Promise<ProductConsoleResponse> {
    const selected = result.selected;
    const diff = selected?.impact
      ? await readDiff(
          this.#options.repositoryPath,
          selected.impact.change.fromCommit,
          selected.impact.change.toCommit,
          changedPath(selected.impact.change.symbolKey),
        )
      : null;
    return {
      ...result,
      status: 'ready',
      source: this.#options.source,
      repositoryLabel:
        this.#options.source === 'example' ? 'Checkout example' : this.#options.repositoryId,
      selected: selected ? { ...selected, diff } : null,
    };
  }
}

function changedPath(symbolKey: string): string {
  const separator = symbolKey.lastIndexOf('::');
  const path = separator > 0 ? symbolKey.slice(0, separator) : '';
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.split('/').some((part) => part === '..' || part.length === 0)
  ) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Impact contains an invalid source path');
  }
  return path;
}

async function readDiff(
  repositoryPath: string,
  fromCommit: string,
  toCommit: string,
  path: string,
): Promise<string> {
  if (!COMMIT_SHA.test(fromCommit) || !COMMIT_SHA.test(toCommit)) {
    throw new MemoryDomainError('CORRUPT_GRAPH', 'Impact contains an invalid commit');
  }
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      repositoryPath,
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--unified=3',
      fromCommit,
      toCommit,
      '--',
      path,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
    },
  );
  return stdout;
}
