import { describe, expect, it } from 'vitest';

import { calculateBinaryMetrics } from '../src/metrics.js';

describe('binary invalidation metrics', () => {
  it('reports every confusion-matrix cell and error id', () => {
    expect(
      calculateBinaryMetrics([
        { id: 'tp', expected: true, predicted: true },
        { id: 'tn', expected: false, predicted: false },
        { id: 'fp', expected: false, predicted: true },
        { id: 'fn', expected: true, predicted: false },
      ]),
    ).toEqual({
      truePositives: 1,
      trueNegatives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0.5,
      recall: 0.5,
      falsePositiveIds: ['fp'],
      falseNegativeIds: ['fn'],
    });
  });

  it('uses null instead of inventing a score with no denominator', () => {
    expect(calculateBinaryMetrics([])).toMatchObject({ precision: null, recall: null });
  });
});
