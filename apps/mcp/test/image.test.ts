import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const runImageContract = process.env['FRESHCONTEXT_MCP_IMAGE_TEST'] === '1';

describe.skipIf(!runImageContract)('pinned MCP runtime image', () => {
  it('serves the documented tools over the Compose stdio command', async () => {
    const projectName = process.env['FRESHCONTEXT_MCP_IMAGE_PROJECT'];
    if (!projectName) throw new Error('FRESHCONTEXT_MCP_IMAGE_PROJECT is required');

    const repositoryRoot = resolve(import.meta.dirname, '../../..');
    const transport = new StdioClientTransport({
      command: 'docker',
      args: [
        'compose',
        '--project-name',
        projectName,
        '--profile',
        'tools',
        'run',
        '--rm',
        '-T',
        'mcp',
      ],
      cwd: repositoryRoot,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'freshcontext-image-contract', version: '0.1.0' });

    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'freshcontext_recall',
        'freshcontext_remember',
        'freshcontext_status',
      ]);

      const status = await client.callTool({
        name: 'freshcontext_status',
        arguments: { repositoryId: 'freshcontext-checkout-example' },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        result: { status: 'ready', indexed: true },
      });
    } finally {
      await client.close();
    }
  }, 60_000);
});
