import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { HydraClient, loadHydraConfig } from '@freshcontext/hydra';

import { runEvaluation } from './runner.js';

const artifact = await runEvaluation(new HydraClient(loadHydraConfig()));
const outputPath = resolve(
  process.env['FRESHCONTEXT_EVALUATION_OUTPUT'] ?? '.freshcontext/evaluation/latest.json',
);
await mkdir(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, outputPath);
} catch (error) {
  await rm(temporaryPath, { force: true });
  throw error;
}
process.stdout.write(`Evaluation ${artifact.evaluationId} written to ${outputPath}\n`);
process.stdout.write(
  `Graph precision ${formatScore(artifact.aggregate.graph.precision)}, recall ${formatScore(artifact.aggregate.graph.recall)}\n`,
);
process.stdout.write(
  `Direct-file precision ${formatScore(artifact.aggregate.directFileBaseline.precision)}, recall ${formatScore(artifact.aggregate.directFileBaseline.recall)}\n`,
);

function formatScore(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
