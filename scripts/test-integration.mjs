import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const projectName = `freshcontext-integration-${process.pid}`;
const port = await getAvailablePort();
const environment = { ...process.env, FRESHCONTEXT_PORT: String(port) };
let testFailed = false;

try {
  await compose(['up', '--build', '--wait', '--wait-timeout', '180']);

  const readyResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const readyBody = await readyResponse.json();
  assert(
    readyResponse.status === 200,
    `Expected ready status 200, received ${readyResponse.status}`,
  );
  assert(readyBody.status === 'ready', 'Expected a ready health body');
  assert(readyBody.hydra === 'connected', 'Expected HydraDB to be connected');
  assert(typeof readyBody.roundTrip?.queryId === 'string', 'Expected a real query id');

  await compose(['--profile', 'test', 'run', '--build', '--rm', 'graph-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'indexer-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'mcp-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'core-contract-test']);

  await compose(['stop', 'hydra']);
  const unavailableBody = await waitForUnavailable(port);
  assert(unavailableBody.hydra === 'unavailable', 'Expected HydraDB to fail closed');

  console.log(
    'Integration proof passed: HydraDB health, graph, indexer, MCP memory, and fail-closed behavior.',
  );
} catch (error) {
  testFailed = true;
  console.error(error);
  await compose(['logs', '--no-color'], { tolerateFailure: true });
} finally {
  await compose(['down', '--volumes', '--remove-orphans'], { tolerateFailure: true });
}

if (testFailed) {
  process.exit(1);
}

async function waitForUnavailable(portNumber) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/api/health`);
      if (response.status === 503) {
        return await response.json();
      }
    } catch {
      // The app may be briefly busy while the upstream connection times out.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Health did not become unavailable after HydraDB stopped');
}

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
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: commandEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped by ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local integration-test port'));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => (error ? reject(error) : resolve(selectedPort)));
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
