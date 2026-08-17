import { describe, expect, it } from 'vitest';

import { parseEvaluationResponse } from '../src/data/evaluation.js';

const metrics = {
  truePositives: 1,
  trueNegatives: 1,
  falsePositives: 0,
  falseNegatives: 0,
  precision: 1,
  recall: 1,
  falsePositiveIds: [],
  falseNegativeIds: [],
} as const;

const response = {
  status: 'ready',
  source: 'verified_reference',
  evaluationId: 'reference-id',
  completedAt: '2026-08-16T21:23:05.480Z',
  command: 'pnpm evaluate',
  engine: 'HydraDB OSS v0.1.1',
  traversalBoundary: 'zero to three reverse call hops',
  dataset: {
    status: 'complete',
    source: 'versioned real Git fixtures',
    caseCount: 1,
    labelCount: 1,
  },
  cases: [
    {
      caseId: 'case-one',
      description: 'A real change case.',
      changeSummary: 'A committed symbol changed.',
      provenance: null,
      beforeCommit: 'a'.repeat(40),
      afterCommit: 'b'.repeat(40),
      labelCount: 1,
      changedSymbolCount: 1,
      unresolvedCallCount: 0,
      labels: [
        {
          id: 'transitive',
          claim: 'Caller behavior follows the changed symbol.',
          evidence: { path: 'src/caller.ts', qualifiedName: 'caller' },
          expectedAffected: true,
          graph: {
            affected: true,
            classification: 'true_positive',
            callHops: 1,
            actualPath: [
              { path: 'src/change.ts', qualifiedName: 'changed' },
              { path: 'src/caller.ts', qualifiedName: 'caller' },
            ],
          },
          directFileBaseline: { affected: false, classification: 'false_negative' },
        },
      ],
      graph: metrics,
      directFileBaseline: { ...metrics, truePositives: 0, falseNegatives: 1, recall: 0 },
    },
  ],
  mcpReceipt: {
    caseId: 'case-one',
    client: '@modelcontextprotocol/sdk Client',
    transport: 'linked in-process MCP transport',
    tool: 'freshcontext_recall',
    registeredTools: ['freshcontext_recall', 'freshcontext_remember', 'freshcontext_status'],
    input: {
      repositoryId: 'evaluation-case-one',
      path: 'src/caller.ts',
      qualifiedName: 'caller',
      beforeCommit: 'a'.repeat(40),
      afterCommit: 'b'.repeat(40),
    },
    memoryId: 'memory-one',
    beforeChange: {
      status: 'ready',
      indexedCommit: 'a'.repeat(40),
      returnedMemoryIds: ['memory-one'],
      withheldMemoryIds: [],
      abstained: false,
      abstentionReason: null,
    },
    afterChange: {
      status: 'ready',
      indexedCommit: 'b'.repeat(40),
      returnedMemoryIds: [],
      withheldMemoryIds: ['memory-one'],
      abstained: true,
      abstentionReason: 'all_matching_memory_unsafe',
    },
  },
  aggregate: { graph: metrics, directFileBaseline: metrics },
} as const;

describe('evaluation API parser', () => {
  it('accepts the complete artifact read model', () => {
    expect(parseEvaluationResponse(response)).toEqual(response);
  });

  it('rejects an unknown result classification', () => {
    expect(() =>
      parseEvaluationResponse({
        ...response,
        cases: [
          {
            ...response.cases[0],
            labels: [
              {
                ...response.cases[0].labels[0],
                graph: { ...response.cases[0].labels[0].graph, classification: 'probably_right' },
              },
            ],
          },
        ],
      }),
    ).toThrow('Invalid evaluation classification');
  });

  it('rejects a score outside the valid range', () => {
    expect(() =>
      parseEvaluationResponse({
        ...response,
        aggregate: { ...response.aggregate, graph: { ...metrics, precision: 1.1 } },
      }),
    ).toThrow('Invalid evaluation score');
  });
});
