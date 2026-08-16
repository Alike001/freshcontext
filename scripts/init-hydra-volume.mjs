import { randomBytes } from 'node:crypto';
import { chmod, chown, mkdir, readFile, writeFile } from 'node:fs/promises';

const dataRoot = '/data';
const tokenPath = `${dataRoot}/auth-token`;
const hydraUserId = 10001;
const hydraGroupId = 10001;

await mkdir(`${dataRoot}/store`, { recursive: true });
await mkdir(`${dataRoot}/cache`, { recursive: true });

let tokenExists = true;
try {
  const existingToken = (await readFile(tokenPath, 'utf8')).trim();
  if (existingToken.length < 32) {
    throw new Error('Existing HydraDB token is too short');
  }
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    tokenExists = false;
  } else {
    throw error;
  }
}

if (!tokenExists) {
  await writeFile(tokenPath, `${randomBytes(32).toString('hex')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o400,
  });
}

await chmod(tokenPath, 0o444);
await chown(tokenPath, hydraUserId, hydraGroupId);
await chown(`${dataRoot}/store`, hydraUserId, hydraGroupId);
await chown(`${dataRoot}/cache`, hydraUserId, hydraGroupId);

console.log(tokenExists ? 'HydraDB credential already exists.' : 'HydraDB credential created.');
