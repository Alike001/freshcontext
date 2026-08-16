import { execFile } from 'node:child_process';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

import { MemoryService, type MemoryRecord, type RecallResult } from '@freshcontext/core';
import { deterministicIntegerId, entityKeys, ImmutableGraphStore } from '@freshcontext/graph';
import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';
import { indexRepository } from '@freshcontext/indexer';

import { rememberOutputSchema } from '../src/schemas.js';

const execFileAsync = promisify(execFile);
const runContract = process.env['HYDRA_MCP_CONTRACT_TEST'] === '1';
const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(
  testDirectory,
  '../../../packages/indexer/test/fixtures/repository',
);
const serverEntry = resolve(testDirectory, '../dist/start.js');

describe.skipIf(!runContract)('pinned HydraDB MCP stdio contract', () => {
  it('captures only indexed evidence and recalls only current memory', async () => {
    const repositoryPath = await createGitFixture();
    const repositoryId = `mcp-contract-${process.pid}-${Date.now()}`;
    const hydra = new HydraClient(loadHydraConfig());
    const graph = new ImmutableGraphStore(hydra);
    const indexed = await indexRepository({ repositoryId, repositoryPath, graph });
    const commitSha = indexed.snapshot.commit.sha;
    const client = await connectClient();

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'freshcontext_recall',
        'freshcontext_remember',
        'freshcontext_status',
      ]);

      const status = await client.callTool({
        name: 'freshcontext_status',
        arguments: { repositoryId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        result: { status: 'ready', indexed: true, indexedCommit: commitSha },
      });

      const missingEvidence = await client.callTool({
        name: 'freshcontext_remember',
        arguments: {
          repositoryId,
          commitSha,
          claim: 'This claim cites a symbol that does not exist.',
          evidence: [{ path: 'src/missing.ts', qualifiedName: 'missing' }],
        },
      });
      expect(missingEvidence.isError).toBe(true);
      expect(containsText(missingEvidence.content, 'EVIDENCE_NOT_FOUND')).toBe(true);

      const rememberArguments = {
        repositoryId,
        commitSha,
        claim: 'calculateTotal includes the fee returned by fee.',
        evidence: [{ path: 'src/pricing.ts', qualifiedName: 'calculateTotal' }],
      };
      const remembered = await client.callTool({
        name: 'freshcontext_remember',
        arguments: rememberArguments,
      });
      const retried = await client.callTool({
        name: 'freshcontext_remember',
        arguments: rememberArguments,
      });
      expect(remembered.isError).not.toBe(true);
      expect(retried.structuredContent).toEqual(remembered.structuredContent);
      const memory: MemoryRecord = rememberOutputSchema.parse(remembered.structuredContent);
      expect(memory).toMatchObject({ state: 'current', evidence: rememberArguments.evidence });

      const recalled = await recall(client, repositoryId, commitSha);
      expect(recalled).toMatchObject({
        status: 'ready',
        memories: [{ memoryId: memory.memoryId }],
        withheldCount: 0,
        abstained: false,
      });

      const noMemory = await recall(client, repositoryId, commitSha, 'fee');
      expect(noMemory).toMatchObject({
        status: 'ready',
        memories: [],
        withheldCount: 0,
        abstained: true,
        abstentionReason: 'no_memory',
      });

      const service = new MemoryService({ graph: new ImmutableGraphStore(hydra), hydra });
      const memoryVertexId = deterministicIntegerId(
        'entity',
        entityKeys.memory(repositoryId, memory.memoryId),
      );
      await service.setMemoryState(memoryVertexId, 'needs_review');
      const withheld = await recall(client, repositoryId, commitSha);
      expect(withheld).toMatchObject({
        status: 'ready',
        memories: [],
        withheldCount: 1,
        withheldMemoryIds: [memory.memoryId],
        abstained: true,
        abstentionReason: 'all_matching_memory_unsafe',
      });

      await commitFixture(repositoryPath, 'new selected commit');
      const next = await indexRepository({
        repositoryId,
        repositoryPath,
        graph: new ImmutableGraphStore(hydra),
      });
      expect(next.snapshot.commit.sha).not.toBe(commitSha);
      const stale = await client.callTool({
        name: 'freshcontext_recall',
        arguments: {
          repositoryId,
          commitSha,
          path: 'src/pricing.ts',
          qualifiedName: 'calculateTotal',
        },
      });
      expect(stale.isError).toBe(true);
      expect(containsText(stale.content, 'STALE_COMMIT')).toBe(true);
    } finally {
      await client.close();
    }

    const unavailableClient = await connectClient({
      HYDRA_QUERY_BASE_URL: 'http://127.0.0.1:1',
      HYDRA_ADMIN_BASE_URL: 'http://127.0.0.1:1',
      HYDRA_REQUEST_TIMEOUT_MS: '100',
    });
    try {
      const unavailable = await unavailableClient.callTool({
        name: 'freshcontext_status',
        arguments: { repositoryId },
      });
      expect(unavailable.isError).not.toBe(true);
      expect(unavailable.structuredContent).toEqual({
        result: {
          status: 'context_unavailable',
          message: 'HydraDB is unavailable, so FreshContext cannot verify memory safety',
        },
      });
      const unavailableRecall = await unavailableClient.callTool({
        name: 'freshcontext_recall',
        arguments: {
          repositoryId,
          commitSha,
          path: 'src/pricing.ts',
          qualifiedName: 'calculateTotal',
        },
      });
      expect(unavailableRecall.isError).not.toBe(true);
      expect(unavailableRecall.structuredContent).toEqual(unavailable.structuredContent);
    } finally {
      await unavailableClient.close();
    }
  }, 120_000);
});

async function recall(
  client: Client,
  repositoryId: string,
  commitSha: string,
  qualifiedName = 'calculateTotal',
): Promise<RecallResult> {
  const result = await client.callTool({
    name: 'freshcontext_recall',
    arguments: {
      repositoryId,
      commitSha,
      path: 'src/pricing.ts',
      qualifiedName,
    },
  });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { result: RecallResult }).result;
}

async function connectClient(overrides: Readonly<Record<string, string>> = {}): Promise<Client> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: resolve(testDirectory, '..'),
    env: { ...environment, ...overrides },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'freshcontext-stdio-contract', version: '0.1.0' });
  await client.connect(transport);
  return client;
}

async function createGitFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'freshcontext-mcp-'));
  await cp(fixtureDirectory, root, { recursive: true });
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'FreshContext Test']);
  await git(root, ['config', 'user.email', 'test@freshcontext.local']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

async function commitFixture(root: string, message: string): Promise<void> {
  await git(root, ['commit', '--allow-empty', '-m', message]);
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function containsText(content: unknown, expected: string): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      item.type === 'text' &&
      'text' in item &&
      typeof item.text === 'string' &&
      item.text.includes(expected),
  );
}
