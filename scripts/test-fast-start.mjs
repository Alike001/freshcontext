import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

const projectName = `freshcontext-fast-start-${process.pid}`;
const port = await getAvailablePort();
const environment = { ...process.env, FRESHCONTEXT_PORT: String(port) };
let testFailed = false;

try {
  await compose(['pull', '--quiet']);

  const startedAt = performance.now();
  await compose(['up', '--wait', '--wait-timeout', '60']);
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const setupResponse = await fetch(`http://127.0.0.1:${port}/api/setup`);
  const consoleResponse = await fetch(`http://127.0.0.1:${port}/api/console`);
  const health = await healthResponse.json();
  const setup = await setupResponse.json();
  const consoleBody = await consoleResponse.json();

  assert(healthResponse.status === 200 && health.hydra === 'connected', 'Expected real health');
  assert(
    setupResponse.status === 200 &&
      setup.repository?.state === 'indexed' &&
      setup.repository?.source === 'example',
    'Expected the real indexed example setup',
  );
  assert(
    consoleResponse.status === 200 &&
      consoleBody.selected?.impact?.callHops === 2 &&
      consoleBody.selected?.impact?.steps?.length === 4,
    'Expected the real two-hop HydraDB proof',
  );
  assert(
    elapsedSeconds <= 30,
    `Expected warm-image empty-volume startup within 30 seconds, received ${elapsedSeconds.toFixed(2)}`,
  );

  console.log(
    `Fast-start proof passed in ${elapsedSeconds.toFixed(2)} seconds with empty data volumes and pre-pulled pinned images.`,
  );
} catch (error) {
  testFailed = true;
  console.error(error);
  await compose(['logs', '--no-color'], { tolerateFailure: true });
} finally {
  await compose(['down', '--volumes', '--remove-orphans'], { tolerateFailure: true });
}

if (testFailed) process.exit(1);

async function compose(arguments_, options = {}) {
  const exitCode = await run(
    'docker',
    ['compose', '--project-name', projectName, ...arguments_],
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

function getAvailablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not reserve a fast-start test port'));
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
