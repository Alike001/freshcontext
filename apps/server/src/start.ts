import { HydraClient, HydraHealthProbe, loadHydraConfig, waitForHydra } from '@freshcontext/hydra';

import { buildApp } from './app.js';

const environment = process.env;
const port = positiveInteger(environment['PORT'], 3_000, 'PORT');
const host = environment['HOST'] ?? '0.0.0.0';
const startupTimeoutMs = positiveInteger(
  environment['HYDRA_STARTUP_TIMEOUT_MS'],
  120_000,
  'HYDRA_STARTUP_TIMEOUT_MS',
);

const hydra = new HydraClient(loadHydraConfig(environment));
await waitForHydra(hydra, { timeoutMs: startupTimeoutMs });
const healthProbe = await HydraHealthProbe.initialize(hydra);
const app = buildApp({ healthGateway: healthProbe, logger: true });

const stop = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Stopping FreshContext');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ error }, 'FreshContext failed to start');
  process.exit(1);
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
