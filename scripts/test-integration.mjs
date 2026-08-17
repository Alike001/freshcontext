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

  const setupResponse = await fetch(`http://127.0.0.1:${port}/api/setup`);
  const setupBody = await setupResponse.json();
  assert(setupResponse.status === 200, 'Expected the setup read model to be available');
  assert(setupBody.hydra === 'connected', 'Expected setup to verify HydraDB');
  assert(
    setupBody.repository?.state === 'indexed' && setupBody.repository?.source === 'example',
    'Expected setup to report the real indexed example repository',
  );

  const consoleResponse = await fetch(`http://127.0.0.1:${port}/api/console`);
  const consoleBody = await consoleResponse.json();
  assert(consoleResponse.status === 200, 'Expected the Proof Console read model to be available');
  assert(consoleBody.source === 'example', 'Expected the Proof Console to label example data');
  assert(
    consoleBody.selected?.memory?.state === 'needs_review' &&
      consoleBody.selected?.impact?.callHops === 2 &&
      consoleBody.selected?.impact?.steps?.length === 4,
    'Expected a real two-hop HydraDB impact proof',
  );
  assert(
    typeof consoleBody.selected?.diff === 'string' &&
      consoleBody.selected.diff.includes('return amount > 100 ? 4 : 1;'),
    'Expected the proof dossier to include the verified Git diff',
  );

  const memoryId = consoleBody.selected.memory.memoryId;
  const reviewResponse = await fetch(
    `http://127.0.0.1:${port}/api/memories/${encodeURIComponent(memoryId)}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replacementClaim: 'Checkout totals use the tiered service fee through calculateTotal.',
      }),
    },
  );
  const reviewBody = await reviewResponse.json();
  assert(reviewResponse.status === 200, 'Expected the review workflow to complete');
  assert(
    reviewBody.selected?.memory?.state === 'superseded' &&
      reviewBody.selected?.replacement?.state === 'current',
    'Expected immutable supersession with a current replacement',
  );

  const evaluationResponse = await fetch(`http://127.0.0.1:${port}/api/evaluation/latest`);
  const evaluationBody = await evaluationResponse.json();
  assert(evaluationResponse.status === 200, 'Expected the evaluation read model to be available');
  assert(
    evaluationBody.source === 'verified_reference',
    'Expected the offline result to identify its verified-reference source',
  );
  assert(
    evaluationBody.aggregate?.graph?.precision === 1 &&
      evaluationBody.aggregate?.graph?.recall === 10 / 11 &&
      evaluationBody.aggregate?.graph?.falseNegatives === 1,
    'Expected the checked pinned-Hydra graph metrics',
  );
  assert(
    evaluationBody.aggregate?.directFileBaseline?.precision === 0.625,
    'Expected the checked direct-file baseline',
  );
  assert(
    evaluationBody.mcpReceipt?.beforeChange?.abstained === false &&
      evaluationBody.mcpReceipt?.afterChange?.abstained === true &&
      evaluationBody.mcpReceipt?.afterChange?.abstentionReason === 'all_matching_memory_unsafe',
    'Expected the checked MCP recall and abstention receipt',
  );

  const productResponse = await fetch(`http://127.0.0.1:${port}/setup`);
  const productHtml = await productResponse.text();
  assert(productResponse.status === 200, 'Expected a direct product route to serve the SPA');
  assert(productHtml.includes('<title>FreshContext</title>'), 'Expected the FreshContext product');
  assert(
    productResponse.headers.get('content-security-policy')?.includes("default-src 'self'"),
    'Expected the product security policy',
  );

  await compose(['--profile', 'test', 'run', '--build', '--rm', 'graph-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'indexer-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'mcp-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'core-contract-test']);
  await compose(['--profile', 'test', 'run', '--build', '--rm', 'evaluation-contract-test']);

  await compose(['stop', 'hydra']);
  const unavailableBody = await waitForUnavailable(port);
  assert(unavailableBody.hydra === 'unavailable', 'Expected HydraDB to fail closed');

  console.log(
    'Integration proof passed: product shell, real example, Proof Console review, HydraDB, graph, indexer, MCP memory, evaluation, and fail-closed behavior.',
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
