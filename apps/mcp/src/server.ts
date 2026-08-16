import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ContextUnavailableError, MemoryDomainError, type MemoryService } from '@freshcontext/core';
import { HydraRequestError } from '@freshcontext/hydra';

import {
  recallInputSchema,
  recallOutputSchema,
  rememberInputSchema,
  rememberOutputSchema,
  statusInputSchema,
  statusOutputSchema,
} from './schemas.js';

export interface MemoryOperations {
  remember: MemoryService['remember'];
  recall: MemoryService['recall'];
  status: MemoryService['status'];
}

export function createFreshContextMcpServer(memory: MemoryOperations): McpServer {
  const server = new McpServer({ name: 'freshcontext', version: '0.1.0' });

  server.registerTool(
    'freshcontext_remember',
    {
      title: 'Remember code knowledge with evidence',
      description:
        'Store a claim only when every cited code symbol exists in the selected FreshContext index.',
      inputSchema: rememberInputSchema,
      outputSchema: rememberOutputSchema,
    },
    async (input) => {
      try {
        const output = await memory.remember(input);
        return toolSuccess(output);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'freshcontext_recall',
    {
      title: 'Recall safe memory for a code symbol',
      description:
        'Return current evidence-bound claims for an exact indexed symbol and report withheld unsafe matches.',
      inputSchema: recallInputSchema,
      outputSchema: recallOutputSchema,
    },
    async (input) => {
      try {
        const output = { result: await memory.recall(input) };
        return toolSuccess(output);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'freshcontext_status',
    {
      title: 'Check FreshContext repository status',
      description:
        'Report the selected completed index and its real ingestion statistics, or context unavailable.',
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
    },
    async (input) => {
      try {
        const output = { result: await memory.status(input) };
        return toolSuccess(output);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function toolSuccess(output: object) {
  const structuredContent = { ...output };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function toolError(error: unknown) {
  const detail =
    error instanceof MemoryDomainError
      ? { code: error.code, message: error.message }
      : error instanceof HydraRequestError || error instanceof ContextUnavailableError
        ? {
            code: 'CONTEXT_UNAVAILABLE',
            message:
              error instanceof ContextUnavailableError
                ? error.message
                : 'HydraDB is unavailable, so FreshContext cannot verify memory safety',
          }
        : { code: 'INTERNAL_ERROR', message: 'FreshContext could not complete the operation' };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(detail) }],
    isError: true,
  };
}
