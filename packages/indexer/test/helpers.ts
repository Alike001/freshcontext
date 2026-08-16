import { execFile } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/repository');

export async function createGitFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'freshcontext-indexer-'));
  await cp(fixtureRoot, root, { recursive: true });
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'FreshContext Test']);
  await git(root, ['config', 'user.email', 'test@freshcontext.local']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

export async function writeFixtureFile(root: string, path: string, content: string): Promise<void> {
  await writeFile(resolve(root, path), content, 'utf8');
}

export async function commitFixture(root: string, message: string): Promise<void> {
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', message]);
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
