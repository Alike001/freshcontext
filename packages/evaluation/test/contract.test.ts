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
      caseCount: 2,
      labelCount: 10,
    });
    expect(artifact.aggregate.graph).toMatchObject({
      truePositives: 6,
      trueNegatives: 3,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 1,
      recall: 6 / 7,
      falseNegativeIds: ['policy-depth:beyond-boundary'],
    });
    expect(artifact.aggregate.directFileBaseline).toMatchObject({
      truePositives: 3,
      trueNegatives: 1,
      falsePositives: 2,
      falseNegatives: 4,
      precision: 3 / 5,
      recall: 3 / 7,
      falsePositiveIds: [
        'policy-depth:same-file-unrelated',
        'pricing-propagation:same-file-unrelated',
      ],
      falseNegativeIds: [
        'policy-depth:beyond-boundary',
        'policy-depth:three-hop-api',
        'policy-depth:two-hop-guard',
        'pricing-propagation:transitive-checkout',
      ],
    });
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
