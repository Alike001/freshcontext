import { execFile } from 'node:child_process';
import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { MemoryService, SyncService, type SafeStatusResult } from '@freshcontext/core';
import type { HydraQueryGateway, ImmutableGraphStore } from '@freshcontext/graph';
import { indexRepository } from '@freshcontext/indexer';

const execFileAsync = promisify(execFile);
const BEFORE_TAG = 'freshcontext-before';
const AFTER_TAG = 'freshcontext-after';
const BEFORE_DATE = '2026-08-12T09:00:00Z';
const AFTER_DATE = '2026-08-13T11:30:00Z';

export interface ExampleBootstrapOptions {
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly sourceRoot: string;
  readonly graph: ImmutableGraphStore;
  readonly hydra: HydraQueryGateway;
}

export interface ExampleBootstrapResult {
  readonly beforeCommit: string;
  readonly afterCommit: string;
}

export async function bootstrapExample(
  options: ExampleBootstrapOptions,
): Promise<ExampleBootstrapResult> {
  await ensureRepository(options.sourceRoot, options.repositoryPath);
  const beforeCommit = await gitText(options.repositoryPath, ['rev-parse', BEFORE_TAG]);
  const afterCommit = await gitText(options.repositoryPath, ['rev-parse', AFTER_TAG]);
  const memory = new MemoryService({
    graph: options.graph,
    hydra: options.hydra,
    clock: () => new Date(BEFORE_DATE),
  });
  const status = await memory.status({ repositoryId: options.repositoryId });
  requireAvailable(status);
  if (
    status.indexedCommit &&
    status.indexedCommit !== beforeCommit &&
    status.indexedCommit !== afterCommit
  ) {
    throw new Error(
      'The example graph selected an unknown commit. Reset the local Compose volumes.',
    );
  }

  if (!status.indexed) {
    await checkout(options.repositoryPath, BEFORE_TAG);
    await indexRepository({
      repositoryId: options.repositoryId,
      repositoryPath: options.repositoryPath,
      graph: options.graph,
    });
  }

  if (!status.indexed || status.indexedCommit === beforeCommit) {
    await checkout(options.repositoryPath, BEFORE_TAG);
    await Promise.all([
      memory.remember({
        repositoryId: options.repositoryId,
        commitSha: beforeCommit,
        claim: 'Checkout totals add a flat $2 service fee through calculateTotal.',
        evidence: [{ path: 'src/checkout.ts', qualifiedName: 'Checkout.total' }],
      }),
      memory.remember({
        repositoryId: options.repositoryId,
        commitSha: beforeCommit,
        claim: 'The service fee is always $2.',
        evidence: [{ path: 'src/pricing.ts', qualifiedName: 'fee' }],
      }),
      memory.remember({
        repositoryId: options.repositoryId,
        commitSha: beforeCommit,
        claim: 'Checkout.dynamic uses the caller-supplied pricing function.',
        evidence: [{ path: 'src/checkout.ts', qualifiedName: 'Checkout.dynamic' }],
      }),
    ]);
    await checkout(options.repositoryPath, AFTER_TAG);
    await new SyncService({ graph: options.graph, hydra: options.hydra }).synchronize({
      repositoryId: options.repositoryId,
      repositoryPath: options.repositoryPath,
    });
  } else {
    await checkout(options.repositoryPath, AFTER_TAG);
  }

  const head = await gitText(options.repositoryPath, ['rev-parse', 'HEAD']);
  if (head !== afterCommit)
    throw new Error('The generated example did not reach its changed commit.');
  return { beforeCommit, afterCommit };
}

async function ensureRepository(sourceRoot: string, repositoryPath: string): Promise<void> {
  if (await exists(resolve(repositoryPath, '.git'))) {
    const [before, after] = await Promise.all([
      gitText(repositoryPath, ['rev-parse', '--verify', BEFORE_TAG]),
      gitText(repositoryPath, ['rev-parse', '--verify', AFTER_TAG]),
    ]);
    if (before === after) throw new Error('The generated example commit history is invalid.');
    return;
  }
  if (await exists(repositoryPath)) {
    throw new Error('The example workspace exists but is not a valid generated Git repository.');
  }
  await mkdir(dirname(repositoryPath), { recursive: true });
  await cp(resolve(sourceRoot, 'before'), repositoryPath, { recursive: true });
  await git(repositoryPath, ['init', '--initial-branch=main']);
  await git(repositoryPath, ['config', 'user.name', 'FreshContext Example']);
  await git(repositoryPath, ['config', 'user.email', 'example@freshcontext.local']);
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '-m', 'Add checkout baseline'], BEFORE_DATE);
  await git(repositoryPath, ['tag', BEFORE_TAG]);
  await cp(resolve(sourceRoot, 'after'), repositoryPath, { recursive: true, force: true });
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '-m', 'Use a tiered checkout fee'], AFTER_DATE);
  await git(repositoryPath, ['tag', AFTER_TAG]);
}

async function checkout(repositoryPath: string, reference: string): Promise<void> {
  await git(repositoryPath, ['checkout', '--detach', reference]);
}

async function git(repositoryPath: string, args: readonly string[], date?: string): Promise<void> {
  await execFileAsync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
}

async function gitText(repositoryPath: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
  });
  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireAvailable(
  status: SafeStatusResult,
): asserts status is Extract<SafeStatusResult, { readonly status: 'ready' }> {
  if (status.status !== 'ready') throw new Error('HydraDB could not verify the example state.');
}
