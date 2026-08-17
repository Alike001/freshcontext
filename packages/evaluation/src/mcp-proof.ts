import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { RecallInput, RecallResult } from '@freshcontext/core';
import {
  createFreshContextMcpServer,
  recallOutputSchema,
  type MemoryOperations,
} from '@freshcontext/mcp';

export interface McpProofSession {
  readonly registeredTools: readonly string[];
  recall(input: RecallInput): Promise<RecallResult>;
  close(): Promise<void>;
}

export async function startMcpProofSession(memory: MemoryOperations): Promise<McpProofSession> {
  const server = createFreshContextMcpServer(memory);
  const client = new Client({ name: 'freshcontext-evaluation', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const tools = await client.listTools();
    const registeredTools = tools.tools.map(({ name }) => name).sort(compareText);
    return {
      registeredTools,
      async recall(input) {
        const response = await client.callTool({
          name: 'freshcontext_recall',
          arguments: { ...input },
        });
        if (response.isError === true) {
          throw new Error('FreshContext MCP recall returned a tool error during evaluation');
        }
        const result = recallOutputSchema.parse(response.structuredContent).result;
        if (result.status !== 'ready') {
          throw new Error('FreshContext MCP recall reported context unavailable during evaluation');
        }
        return result;
      },
      async close() {
        await Promise.all([client.close(), server.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([client.close(), server.close()]);
    throw error;
  }
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}
