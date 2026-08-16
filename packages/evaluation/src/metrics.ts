export interface BinaryLabel {
  readonly id: string;
  readonly expected: boolean;
  readonly predicted: boolean;
}

export interface BinaryMetrics {
  readonly truePositives: number;
  readonly trueNegatives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly falsePositiveIds: readonly string[];
  readonly falseNegativeIds: readonly string[];
}

export function calculateBinaryMetrics(labels: readonly BinaryLabel[]): BinaryMetrics {
  const truePositives = labels.filter((label) => label.expected && label.predicted);
  const trueNegatives = labels.filter((label) => !label.expected && !label.predicted);
  const falsePositives = labels.filter((label) => !label.expected && label.predicted);
  const falseNegatives = labels.filter((label) => label.expected && !label.predicted);
  const predictedPositive = truePositives.length + falsePositives.length;
  const expectedPositive = truePositives.length + falseNegatives.length;
  return {
    truePositives: truePositives.length,
    trueNegatives: trueNegatives.length,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    precision: predictedPositive === 0 ? null : truePositives.length / predictedPositive,
    recall: expectedPositive === 0 ? null : truePositives.length / expectedPositive,
    falsePositiveIds: falsePositives.map((label) => label.id).sort(),
    falseNegativeIds: falseNegatives.map((label) => label.id).sort(),
  };
}
