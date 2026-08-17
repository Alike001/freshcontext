import { describe, expect, it } from 'vitest';

import { parseCaseManifest } from '../src/runner.js';

const validManifest = {
  caseId: 'case-a',
  description: 'A real change case.',
  changeSummary: 'Change one symbol.',
  labels: [
    {
      id: 'affected',
      claim: 'The affected claim.',
      path: 'src/a.ts',
      qualifiedName: 'a',
      expected: true,
      expectedPath: [{ path: 'src/a.ts', qualifiedName: 'a' }],
    },
  ],
};

describe('evaluation manifest validation', () => {
  it('accepts an affected label with an explicit expected path', () => {
    expect(parseCaseManifest(JSON.stringify(validManifest))).toMatchObject({ caseId: 'case-a' });
  });

  it('rejects duplicate label ids', () => {
    expect(() =>
      parseCaseManifest(
        JSON.stringify({
          ...validManifest,
          labels: [validManifest.labels[0], validManifest.labels[0]],
        }),
      ),
    ).toThrow('Evaluation label ids must be unique');
  });

  it('rejects an affected label without an expected path', () => {
    expect(() =>
      parseCaseManifest(
        JSON.stringify({
          ...validManifest,
          labels: [{ ...validManifest.labels[0], expectedPath: null }],
        }),
      ),
    ).toThrow('Affected evaluation labels need a path');
  });

  it('rejects a path that does not end at the claimed evidence', () => {
    expect(() =>
      parseCaseManifest(
        JSON.stringify({
          ...validManifest,
          labels: [
            {
              ...validManifest.labels[0],
              expectedPath: [{ path: 'src/other.ts', qualifiedName: 'other' }],
            },
          ],
        }),
      ),
    ).toThrow('Expected impact path must end at the memory evidence');
  });

  it('accepts full public provenance and an affected MCP receipt label', () => {
    const result = parseCaseManifest(
      JSON.stringify({
        ...validManifest,
        provenance: {
          kind: 'public_repository',
          repository: 'example/project',
          url: 'https://github.com/example/project',
          beforeCommit: 'a'.repeat(40),
          afterCommit: 'b'.repeat(40),
          license: 'MIT',
          sourcePaths: ['src/a.ts'],
        },
        mcpReceiptLabelId: 'affected',
      }),
    );
    expect(result).toMatchObject({
      provenance: { repository: 'example/project' },
      mcpReceiptLabelId: 'affected',
    });
  });

  it('rejects an MCP receipt label without public provenance', () => {
    expect(() =>
      parseCaseManifest(JSON.stringify({ ...validManifest, mcpReceiptLabelId: 'affected' })),
    ).toThrow('MCP receipt requires public repository provenance');
  });
});
