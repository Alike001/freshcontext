import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inspectRepository } from '../src/git.js';
import { createRepositoryGraphPlan } from '../src/graph-plan.js';
import { buildRepositorySnapshot } from '../src/snapshot.js';
import { commitFixture, createGitFixture, writeFixtureFile } from './helpers.js';

describe('TypeScript repository snapshots', () => {
  it('indexes tracked files, symbols, imports, resolved calls, and honest unknowns', async () => {
    const root = await createGitFixture();
    const descriptor = await inspectRepository(root);
    const snapshot = buildRepositorySnapshot('fixture', descriptor);

    expect(snapshot.files.map((file) => file.path)).toEqual(['src/checkout.ts', 'src/pricing.ts']);
    expect(snapshot.skippedFiles).toEqual([
      { path: 'scripts/not-indexed.ts', reason: 'not-in-tsconfig', diagnosticCodes: [] },
    ]);
    expect(snapshot.symbols.map((symbol) => symbol.key)).toEqual([
      'src/checkout.ts::Checkout.dynamic',
      'src/checkout.ts::Checkout.total',
      'src/pricing.ts::calculateTotal',
      'src/pricing.ts::fee',
      'src/pricing.ts::formatTotal',
    ]);
    expect(snapshot.imports).toEqual([
      {
        sourcePath: 'src/checkout.ts',
        targetPath: 'src/pricing.ts',
        moduleSpecifier: './pricing.js',
      },
    ]);
    expect(snapshot.calls).toEqual([
      {
        callerKey: 'src/checkout.ts::Checkout.total',
        calleeKey: 'src/pricing.ts::calculateTotal',
      },
      {
        callerKey: 'src/pricing.ts::calculateTotal',
        calleeKey: 'src/pricing.ts::fee',
      },
      {
        callerKey: 'src/pricing.ts::formatTotal',
        calleeKey: 'src/pricing.ts::calculateTotal',
      },
    ]);
    expect(snapshot.statistics.unresolvedCallCount).toBe(1);
    expect(snapshot.statistics.externalCallCount).toBe(1);
    expect(buildRepositorySnapshot('fixture', descriptor)).toEqual(snapshot);
  });

  it('turns every persisted code record into a commit-scoped graph relationship', async () => {
    const root = await createGitFixture();
    const snapshot = buildRepositorySnapshot('fixture', await inspectRepository(root));
    const plan = createRepositoryGraphPlan(snapshot);

    const kinds = [...plan.content, ...plan.completion].map((relationship) => relationship.kind);
    expect(kinds).toContain('IMPORTS');
    expect(kinds).toContain('CALLS');
    expect(kinds).toContain('HAS_INDEX_RUN');
    expect(plan.completion).toHaveLength(2);
  });

  it('bounds persisted diagnostic details while preserving the complete count', async () => {
    const root = await createGitFixture();
    const snapshot = buildRepositorySnapshot('fixture-diagnostics', await inspectRepository(root));
    const diagnostics = Array.from({ length: 60 }, (_, index) => ({
      code: 9000 + index,
      message: `Diagnostic ${index}`,
      path: 'src/pricing.ts',
      line: index + 1,
    }));
    const plan = createRepositoryGraphPlan({
      ...snapshot,
      diagnostics,
      statistics: { ...snapshot.statistics, syntacticDiagnosticCount: diagnostics.length },
    });
    const completion = plan.completion.find(
      (relationship) => relationship.kind === 'HAS_INDEX_RUN',
    );

    expect(completion).toBeDefined();
    expect(completion?.target.payload.match(/"message"/gu)).toHaveLength(50);
    expect(completion?.target.payload).toContain('"diagnosticsTruncated":10');
  });

  it('skips a tracked file with syntax errors and exposes the diagnostic', async () => {
    const root = await createGitFixture();
    await writeFixtureFile(root, 'src/broken.ts', 'export function broken( {\n');
    await commitFixture(root, 'add broken source');

    const snapshot = buildRepositorySnapshot('fixture-broken', await inspectRepository(root));
    expect(snapshot.skippedFiles).toContainEqual(
      expect.objectContaining({ path: 'src/broken.ts', reason: 'syntax-errors' }),
    );
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.path === 'src/broken.ts')).toBe(
      true,
    );
  });

  it('rejects invalid and dirty repositories with stable error codes', async () => {
    const notGit = await mkdtemp(resolve(tmpdir(), 'freshcontext-not-git-'));
    await expect(inspectRepository(notGit)).rejects.toMatchObject({
      code: 'NOT_A_GIT_REPOSITORY',
    });

    const root = await createGitFixture();
    await writeFixtureFile(root, 'src/pricing.ts', 'export const dirty = true;\n');
    await expect(inspectRepository(root)).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
  });
});
