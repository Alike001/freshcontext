import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve('.freshcontext/evaluation');
await mkdir(outputDirectory, { recursive: true });

const environment = {
  ...process.env,
  LOCAL_UID: String(process.getuid?.() ?? 1000),
  LOCAL_GID: String(process.getgid?.() ?? 1000),
};
const projectName = `freshcontext-evaluation-${process.pid}`;

let exitCode;
try {
  exitCode = await runCompose(['--profile', 'tools', 'run', '--build', '--rm', 'evaluation']);
} finally {
  await runCompose(['down', '--volumes', '--remove-orphans'], true);
}

process.exitCode = exitCode;

function runCompose(arguments_, tolerateFailure = false) {
  return new Promise((resolveExit, reject) => {
    const child = spawn('docker', ['compose', '--project-name', projectName, ...arguments_], {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Evaluation stopped by ${signal}`));
        return;
      }
      const result = code ?? 1;
      if (result !== 0 && !tolerateFailure) {
        reject(new Error(`docker compose ${arguments_.join(' ')} exited with ${result}`));
        return;
      }
      resolveExit(result);
    });
  });
}
