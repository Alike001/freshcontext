import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectName = `freshcontext-configured-${process.pid}`;
const repositoryPath = await createRepository();
const port = await getAvailablePort();
const repositoryId = `configured-contract-${process.pid}`;
const environment = {
  ...process.env,
  FRESHCONTEXT_PORT: String(port),
  FRESHCONTEXT_HOST_REPOSITORY_PATH: repositoryPath,
  FRESHCONTEXT_REPOSITORY_ID: repositoryId,
};
let testFailed = false;

try {
  await compose(['up', '--build', '--wait', '--wait-timeout', '180']);

  const before = await readSetup();
  assert(before.response.status === 200, 'Expected Setup to be available before indexing');
  assert(before.body.repository?.state === 'not_indexed', 'Expected an honest not-indexed state');
  assert(before.body.repository?.source === 'configured', 'Expected the configured source label');

  const indexed = await repositoryOperation('index');
  const firstCommit = await gitOutput(repositoryPath, ['rev-parse', 'HEAD']);
  assert(indexed.response.status === 200, 'Expected repository indexing to complete');
  assert(indexed.body.repository?.state === 'indexed', 'Expected a completed configured index');
  assert(
    indexed.body.repository?.indexedCommit === firstCommit,
    'Expected Setup to report the real mounted repository commit',
  );
  assert(
    indexed.body.repository?.statistics?.indexedFileCount === 2 &&
      indexed.body.repository?.statistics?.importEdgeCount === 1,
    'Expected real TypeScript ingestion statistics',
  );

  await writeFile(
    resolve(repositoryPath, 'leaf.ts'),
    'export function amount(value: number): number { return value + 2; }\n',
    'utf8',
  );
  await git(repositoryPath, ['add', 'leaf.ts']);
  await git(repositoryPath, ['commit', '-m', 'change leaf']);
  const secondCommit = await gitOutput(repositoryPath, ['rev-parse', 'HEAD']);

  const synchronized = await repositoryOperation('sync');
  assert(synchronized.response.status === 200, 'Expected committed synchronization to complete');
  assert(
    synchronized.body.repository?.indexedCommit === secondCommit,
    'Expected synchronization to select the new real commit',
  );

  await writeFile(
    resolve(repositoryPath, 'leaf.ts'),
    'export function amount(value: number): number { return value + 3; }\n',
    'utf8',
  );
  const rejected = await repositoryOperation('sync');
  assert(rejected.response.status === 422, 'Expected a dirty repository to fail validation');
  const invalid = await readSetup();
  assert(
    invalid.body.repository?.state === 'invalid_repository',
    'Expected Setup to preserve the invalid-repository state',
  );
  assert(
    invalid.body.repository?.message.includes('clean worktree'),
    'Expected an actionable clean-worktree message',
  );

  console.log(
    'Configured repository proof passed: read-only mount, real index, committed sync, and explicit dirty-worktree rejection.',
  );
} catch (error) {
  testFailed = true;
  console.error(error);
  await compose(['logs', '--no-color'], { tolerateFailure: true });
} finally {
  await compose(['down', '--volumes', '--remove-orphans'], { tolerateFailure: true });
  await rm(repositoryPath, { recursive: true, force: true });
}

if (testFailed) process.exit(1);

async function readSetup() {
  const response = await fetch(`http://127.0.0.1:${port}/api/setup`);
  return { response, body: await response.json() };
}

async function repositoryOperation(operation) {
  const response = await fetch(`http://127.0.0.1:${port}/api/repositories/${operation}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  return { response, body: await response.json() };
}

async function createRepository() {
  const root = await mkdtemp(resolve(tmpdir(), 'freshcontext-configured-repository-'));
  await writeFile(
    resolve(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
    'utf8',
  );
  await writeFile(
    resolve(root, 'leaf.ts'),
    'export function amount(value: number): number { return value + 1; }\n',
    'utf8',
  );
  await writeFile(
    resolve(root, 'root.ts'),
    "import { amount } from './leaf.js';\nexport const total = amount(10);\n",
    'utf8',
  );
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'FreshContext Test']);
  await git(root, ['config', 'user.email', 'test@freshcontext.local']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

async function compose(arguments_, options = {}) {
  const exitCode = await run(
    'docker',
    [
      'compose',
      '--project-name',
      projectName,
      '-f',
      'compose.yaml',
      '-f',
      'compose.build.yaml',
      '-f',
      'compose.repository.yaml',
      ...arguments_,
    ],
    environment,
  );
  if (exitCode !== 0 && !options.tolerateFailure) {
    throw new Error(`docker compose ${arguments_.join(' ')} exited with ${exitCode}`);
  }
}

function run(command, arguments_, commandEnvironment) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, { env: commandEnvironment, stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`${command} stopped by ${signal}`));
      else resolveRun(code ?? 1);
    });
  });
}

async function git(root, arguments_) {
  await execFileAsync('git', ['-C', root, ...arguments_], { encoding: 'utf8' });
}

async function gitOutput(root, arguments_) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
  });
  return stdout.trim();
}

function getAvailablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not reserve a configured-test port'));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => (error ? rejectPort(error) : resolvePort(selectedPort)));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
