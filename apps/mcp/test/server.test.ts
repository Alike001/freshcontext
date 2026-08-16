import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryDomainError, type MemoryRecord } from '@freshcontext/core';

import { createFreshContextMcpServer, type MemoryOperations } from '../src/server.js';

const commitSha = 'a'.repeat(40);
const memoryRecord: MemoryRecord = {
  memoryId: 'memory-1',
  claim: 'Authentication rejects an empty user id.',
  repositoryId: 'fixture',
  sourceCommit: commitSha,
  createdAt: '2026-08-16T12:00:00.000Z',
  state: 'current',
  evidence: [{ path: 'src/auth.ts', qualifiedName: 'requireUser' }],
};

describe('FreshContext MCP tool contracts', () => {
  let client: Client;
  let server: ReturnType<typeof createFreshContextMcpServer>;

  beforeEach(async () => {
    const memory: MemoryOperations = {
      remember: (input) => {
        if (input.claim === 'reject') {
          return Promise.reject(
            new MemoryDomainError('EVIDENCE_NOT_FOUND', 'Evidence is not indexed'),
          );
        }
        return Promise.resolve(memoryRecord);
      },
      recall: () =>
        Promise.resolve({
          status: 'ready',
          repositoryId: 'fixture',
          indexedCommit: commitSha,
          context: memoryRecord.evidence[0]!,
          memories: [memoryRecord],
          withheldCount: 0,
          withheldMemoryIds: [],
          abstained: false,
          abstentionReason: null,
        }),
      status: () =>
        Promise.resolve({
          status: 'ready',
          repositoryId: 'fixture',
          indexed: true,
          indexedCommit: commitSha,
          statistics: { indexedFileCount: 1 },
        }),
    };
    server = createFreshContextMcpServer(memory);
    client = new Client({ name: 'freshcontext-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  it('publishes exactly the three approved V1 tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'freshcontext_recall',
      'freshcontext_remember',
      'freshcontext_status',
    ]);
  });

  it('returns structured evidence-bound memory', async () => {
    const result = await client.callTool({
      name: 'freshcontext_remember',
      arguments: {
        repositoryId: 'fixture',
        commitSha,
        claim: memoryRecord.claim,
        evidence: memoryRecord.evidence,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(memoryRecord);
  });

  it('rejects unknown input keys and reports domain failures as tool errors', async () => {
    const invalid = await client.callTool({
      name: 'freshcontext_status',
      arguments: { repositoryId: 'fixture', invented: true },
    });
    expect(invalid.isError).toBe(true);

    const rejected = await client.callTool({
      name: 'freshcontext_remember',
      arguments: {
        repositoryId: 'fixture',
        commitSha,
        claim: 'reject',
        evidence: memoryRecord.evidence,
      },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toContainEqual({
      type: 'text',
      text: JSON.stringify({ code: 'EVIDENCE_NOT_FOUND', message: 'Evidence is not indexed' }),
    });
  });
});
