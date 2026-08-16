import { execFile } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { deterministicIntegerId, entityKeys, ImmutableGraphStore } from '@freshcontext/graph';
import { HydraClient, loadHydraConfig, type HydraQueryResponse } from '@freshcontext/hydra';
import { indexRepository } from '@freshcontext/indexer';

import { MemoryService } from '../src/memory-service.js';
import { INSPECT_MEMORY_IMPACTS_QUERY, INSPECT_MEMORY_STATE_QUERY } from '../src/queries.js';
import { SyncService } from '../src/sync-service.js';
import type { MemoryRecord, RecallResult } from '../src/types.js';

const execFileAsync = promisify(execFile);
const runContract = process.env['HYDRA_CORE_CONTRACT_TEST'] === '1';
const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, '../../indexer/test/fixtures/repository');

describe.skipIf(!runContract)('pinned HydraDB impact synchronization contract', () => {
  it('persists shortest proofs, withholds affected memory, and resumes interruption', async () => {
    const repositoryPath = await createGitFixture();
    const repositoryId = `core-contract-${process.pid}-${Date.now()}`;
    const hydra = new HydraClient(loadHydraConfig());
    const graph = new ImmutableGraphStore(hydra);
    const baseline = await indexRepository({ repositoryId, repositoryPath, graph });
    const fromCommit = baseline.snapshot.commit.sha;
    const memory = new MemoryService({ graph, hydra });
    const direct = await remember(memory, repositoryId, fromCommit, 'fee', 'fee changes pricing');
    const transitive = await remember(
      memory,
      repositoryId,
      fromCommit,
      'Checkout.total',
      'Checkout total includes the fee through calculateTotal',
      'src/checkout.ts',
    );
    const unrelated = await remember(
      memory,
      repositoryId,
      fromCommit,
      'Checkout.dynamic',
      'dynamic dispatch stays unrelated to pricing',
      'src/checkout.ts',
    );
    const removed = await remember(
      memory,
      repositoryId,
      fromCommit,
      'formatTotal',
      'formatTotal returns the calculated amount as text',
    );

    await writeFile(
      resolve(repositoryPath, 'src/pricing.ts'),
      `export function fee(amount: number): number {
  return amount > 100 ? 4 : 1;
}

export function calculateTotal(amount: number): number {
  return amount + fee(amount);
}
`,
      'utf8',
    );
    await git(repositoryPath, ['add', 'src/pricing.ts']);
    await git(repositoryPath, ['commit', '-m', 'change fee and remove formatter']);

    const interrupted = new SyncService({
      graph: new ImmutableGraphStore(hydra),
      hydra,
      faultInjector: (checkpoint) => {
        if (checkpoint === 'indexed') throw new Error('intentional contract interruption');
      },
    });
    await expect(interrupted.synchronize({ repositoryId, repositoryPath })).rejects.toThrow(
      'intentional contract interruption',
    );
    await expectRecallUnavailable(memory, repositoryId, fromCommit, 'Checkout.total');

    const synchronized = await new SyncService({
      graph: new ImmutableGraphStore(hydra),
      hydra,
    }).synchronize({ repositoryId, repositoryPath });
    expect(synchronized.fromCommit).toBe(fromCommit);
    expect(synchronized.changeCount).toBe(2);
    expect(synchronized.impactedMemoryIds).toEqual(
      [direct.memoryId, transitive.memoryId, removed.memoryId].sort(),
    );
    const toCommit = synchronized.toCommit;

    await expectWithheld(memory, repositoryId, toCommit, 'fee', direct.memoryId);
    await expectWithheld(
      memory,
      repositoryId,
      toCommit,
      'Checkout.total',
      transitive.memoryId,
      'src/checkout.ts',
    );
    const unrelatedRecall = await recall(
      memory,
      repositoryId,
      toCommit,
      'Checkout.dynamic',
      'src/checkout.ts',
    );
    expect(unrelatedRecall).toMatchObject({
      status: 'ready',
      memories: [{ memoryId: unrelated.memoryId }],
      withheldCount: 0,
      abstained: false,
    });
    expect(await memoryState(hydra, repositoryId, removed.memoryId)).toBe('needs_review');
    expect(await memoryState(hydra, repositoryId, unrelated.memoryId)).toBe('current');
    expect(await impactCallHops(hydra, repositoryId, direct.memoryId)).toEqual([0]);
    expect(await impactCallHops(hydra, repositoryId, transitive.memoryId)).toEqual([2]);
    expect(await impactCallHops(hydra, repositoryId, removed.memoryId)).toEqual([0]);
    expect(await impactCallHops(hydra, repositoryId, unrelated.memoryId)).toEqual([]);

    const duplicate = await new SyncService({
      graph: new ImmutableGraphStore(hydra),
      hydra,
    }).synchronize({ repositoryId, repositoryPath });
    expect(duplicate).toEqual({ ...synchronized, reused: true });
    expect(await impactCallHops(hydra, repositoryId, transitive.memoryId)).toEqual([2]);
  }, 180_000);
});

async function remember(
  memory: MemoryService,
  repositoryId: string,
  commitSha: string,
  qualifiedName: string,
  claim: string,
  path = 'src/pricing.ts',
): Promise<MemoryRecord> {
  return memory.remember({
    repositoryId,
    commitSha,
    claim,
    evidence: [{ path, qualifiedName }],
  });
}

async function recall(
  memory: MemoryService,
  repositoryId: string,
  commitSha: string,
  qualifiedName: string,
  path = 'src/pricing.ts',
): Promise<RecallResult> {
  const result = await memory.recall({ repositoryId, commitSha, path, qualifiedName });
  if (result.status !== 'ready') throw new Error('Expected ready recall');
  return result;
}

async function expectRecallUnavailable(
  memory: MemoryService,
  repositoryId: string,
  commitSha: string,
  qualifiedName: string,
): Promise<void> {
  await expect(
    memory.recall({
      repositoryId,
      commitSha,
      path: 'src/checkout.ts',
      qualifiedName,
    }),
  ).resolves.toMatchObject({ status: 'context_unavailable' });
}

async function expectWithheld(
  memory: MemoryService,
  repositoryId: string,
  commitSha: string,
  qualifiedName: string,
  memoryId: string,
  path = 'src/pricing.ts',
): Promise<void> {
  await expect(recall(memory, repositoryId, commitSha, qualifiedName, path)).resolves.toMatchObject(
    {
      memories: [],
      withheldCount: 1,
      withheldMemoryIds: [memoryId],
      abstained: true,
      abstentionReason: 'all_matching_memory_unsafe',
    },
  );
}

async function memoryState(
  hydra: HydraClient,
  repositoryId: string,
  memoryId: string,
): Promise<string | null> {
  const response = await hydra.query(INSPECT_MEMORY_STATE_QUERY, {
    parameters: {
      memoryId: deterministicIntegerId('entity', entityKeys.memory(repositoryId, memoryId)),
    },
    consistency: 'strong',
  });
  return stringCell(response, 0, 'state');
}

async function impactCallHops(
  hydra: HydraClient,
  repositoryId: string,
  memoryId: string,
): Promise<number[]> {
  const response = await hydra.query(INSPECT_MEMORY_IMPACTS_QUERY, {
    parameters: {
      memoryId: deterministicIntegerId('entity', entityKeys.memory(repositoryId, memoryId)),
    },
    consistency: 'strong',
  });
  return response.rows.map((_, row) => {
    const payload = stringCell(response, row, 'payload');
    if (!payload) throw new Error('Impact payload missing');
    const parsed = JSON.parse(payload) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('properties' in parsed) ||
      typeof parsed.properties !== 'object' ||
      parsed.properties === null ||
      !('callHops' in parsed.properties) ||
      typeof parsed.properties.callHops !== 'number'
    ) {
      throw new Error('Impact call hops missing');
    }
    return parsed.properties.callHops;
  });
}

function stringCell(response: HydraQueryResponse, row: number, column: string): string | null {
  const columnIndex = response.columns.indexOf(column);
  const cell = columnIndex >= 0 ? response.rows[row]?.[columnIndex] : undefined;
  if (!cell || (cell.type !== 'string' && cell.type !== 'null')) {
    throw new Error(`Expected string column ${column}`);
  }
  return cell.type === 'null' ? null : cell.value;
}

async function createGitFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'freshcontext-core-'));
  await cp(fixtureDirectory, root, { recursive: true });
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'FreshContext Test']);
  await git(root, ['config', 'user.email', 'test@freshcontext.local']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
