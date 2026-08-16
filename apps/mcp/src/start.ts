import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { MemoryService } from '@freshcontext/core';
import { ImmutableGraphStore } from '@freshcontext/graph';
import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';

import { createFreshContextMcpServer } from './server.js';

async function start(): Promise<void> {
  const hydra = new HydraClient(loadHydraConfig());
  const memory = new MemoryService({ graph: new ImmutableGraphStore(hydra), hydra });
  const server = createFreshContextMcpServer(memory);
  await server.connect(new StdioServerTransport());
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`FreshContext MCP failed to start: ${message}`);
  process.exitCode = 1;
});
