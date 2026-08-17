import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileEvaluationGateway, parseEvaluationArtifact } from '../src/evaluation.js';

const referencePath = resolve(import.meta.dirname, '../../../evaluation/reference-result.json');

describe('verified evaluation artifact', () => {
  it('parses the complete real pinned-Hydra reference and preserves its visible boundary', async () => {
    const result = await new FileEvaluationGateway(referencePath).read();

    expect(result).toMatchObject({
      status: 'ready',
      source: 'verified_reference',
      evaluationId: '83fa685433442945',
      dataset: { caseCount: 3, labelCount: 16 },
      aggregate: {
        graph: { truePositives: 10, falsePositives: 0, falseNegatives: 1, precision: 1 },
        directFileBaseline: {
          truePositives: 5,
          falsePositives: 3,
          falseNegatives: 6,
          precision: 0.625,
        },
      },
      mcpReceipt: {
        caseId: 'mcp-request-id-zero',
        beforeChange: { abstained: false },
        afterChange: {
          abstained: true,
          abstentionReason: 'all_matching_memory_unsafe',
        },
      },
    });
    expect(result.aggregate.graph.recall).toBeCloseTo(10 / 11);
    expect(result.aggregate.directFileBaseline.recall).toBeCloseTo(5 / 11);
    expect(result.aggregate.graph.falseNegativeIds).toEqual(['policy-depth:beyond-boundary']);
  });

  it('rejects a score that disagrees with its confusion matrix', async () => {
    const value = JSON.parse(await readFile(referencePath, 'utf8')) as Record<string, unknown>;
    const aggregate = value['aggregate'] as Record<string, unknown>;
    const graph = aggregate['graph'] as Record<string, unknown>;
    graph['precision'] = 0.99;

    expect(() => parseEvaluationArtifact(value)).toThrow(
      'aggregate graph scores do not match its confusion matrix',
    );
  });

  it('rejects a graph classification that disagrees with its prediction', async () => {
    const value = JSON.parse(await readFile(referencePath, 'utf8')) as Record<string, unknown>;
    const cases = value['cases'] as Record<string, unknown>[];
    const labels = cases[0]?.['labels'] as Record<string, unknown>[];
    const graph = labels[0]?.['graph'] as Record<string, unknown>;
    graph['classification'] = 'true_negative';

    expect(() => parseEvaluationArtifact(value)).toThrow('has an invalid graph classification');
  });

  it('rejects a receipt that hides the unsafe memory after the change', async () => {
    const value = JSON.parse(await readFile(referencePath, 'utf8')) as Record<string, unknown>;
    const receipt = value['mcpReceipt'] as Record<string, unknown>;
    const after = receipt['afterChange'] as Record<string, unknown>;
    after['withheldMemoryIds'] = [];

    expect(() => parseEvaluationArtifact(value)).toThrow('does not prove recall then abstention');
  });
});
