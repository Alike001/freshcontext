import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const projectName = `freshcontext-mcp-image-${process.pid}`;
const port = await getAvailablePort();
const environment = {
  ...process.env,
  FRESHCONTEXT_PORT: String(port),
  FRESHCONTEXT_MCP_IMAGE_TEST: '1',
  FRESHCONTEXT_MCP_IMAGE_PROJECT: projectName,
};
let testFailed = false;

try {
  await compose(['--profile', 'tools', 'pull', '--quiet']);
  await compose(['up', '--wait', '--wait-timeout', '60']);
  await runRequired('pnpm', [
    '--filter',
    '@freshcontext/mcp',
    'exec',
    'vitest',
    'run',
    'test/image.test.ts',
  ]);
  console.log('Pinned MCP image proof passed with the official client and real HydraDB state.');
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

async function runRequired(command, arguments_) {
  const exitCode = await run(command, arguments_, environment);
  if (exitCode !== 0) throw new Error(`${command} ${arguments_.join(' ')} exited with ${exitCode}`);
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
        rejectPort(new Error('Could not reserve an MCP image test port'));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => (error ? rejectPort(error) : resolvePort(selectedPort)));
    });
  });
}
