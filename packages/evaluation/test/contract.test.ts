import { describe, expect, it } from 'vitest';

import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';

import { runEvaluation } from '../src/runner.js';

const runContract = process.env['HYDRA_EVALUATION_CONTRACT_TEST'] === '1';

describe.skipIf(!runContract)('pinned HydraDB invalidation evaluation', () => {
  it('beats direct-file matching while reporting the documented traversal boundary', async () => {
    const artifact = await runEvaluation(new HydraClient(loadHydraConfig()));
    expect(artifact.dataset).toEqual({
      status: 'complete',
      source: 'versioned real Git fixtures',
      caseCount: 3,
      labelCount: 16,
    });
    expect(artifact.aggregate.graph).toMatchObject({
      truePositives: 10,
      trueNegatives: 5,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 1,
      recall: 10 / 11,
      falseNegativeIds: ['policy-depth:beyond-boundary'],
    });
    expect(artifact.aggregate.directFileBaseline).toMatchObject({
      truePositives: 5,
      trueNegatives: 2,
      falsePositives: 3,
      falseNegatives: 6,
      precision: 5 / 8,
      recall: 5 / 11,
      falsePositiveIds: [
        'mcp-request-id-zero:connect-unrelated',
        'policy-depth:same-file-unrelated',
        'pricing-propagation:same-file-unrelated',
      ],
      falseNegativeIds: [
        'mcp-request-id-zero:resource-updated',
        'mcp-request-id-zero:tool-list-changed',
        'policy-depth:beyond-boundary',
        'policy-depth:three-hop-api',
        'policy-depth:two-hop-guard',
        'pricing-propagation:transitive-checkout',
      ],
    });
    expect(artifact.mcpReceipt).toMatchObject({
      caseId: 'mcp-request-id-zero',
      client: '@modelcontextprotocol/sdk Client',
      tool: 'freshcontext_recall',
      beforeChange: { abstained: false, withheldMemoryIds: [] },
      afterChange: {
        abstained: true,
        returnedMemoryIds: [],
        abstentionReason: 'all_matching_memory_unsafe',
      },
    });
    expect(artifact.mcpReceipt.beforeChange.returnedMemoryIds).toContain(
      artifact.mcpReceipt.memoryId,
    );
    expect(artifact.mcpReceipt.afterChange.withheldMemoryIds).toContain(
      artifact.mcpReceipt.memoryId,
    );
    const depthCase = artifact.cases.find((entry) => entry.caseId === 'policy-depth');
    for (const result of artifact.cases.flatMap((entry) => entry.labels)) {
      if (result.graph.classification === 'true_positive') {
        expect(result.graph.actualPath).toEqual(result.expectedPath);
      }
    }
    expect(depthCase?.labels.find((label) => label.id === 'three-hop-api')?.graph).toMatchObject({
      affected: true,
      callHops: 3,
    });
    expect(depthCase?.labels.find((label) => label.id === 'beyond-boundary')?.graph).toMatchObject({
      affected: false,
      classification: 'false_negative',
      callHops: null,
      actualPath: null,
    });
  }, 180_000);
});
