import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const prohibitedFiles = new Set([
  'AGENTS.md',
  'PROMPTS.md',
  'architecture.md',
  'design.doc.md',
  'handoff.md',
  'log.md',
  'PRD.md',
  'research-intake.md',
]);

const secretPatterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u },
  { name: 'OpenAI key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
];

let output;
try {
  output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
} catch (error) {
  if (
    error instanceof Error &&
    'status' in error &&
    error.status === 0 &&
    'stdout' in error &&
    typeof error.stdout === 'string'
  ) {
    output = error.stdout;
  } else {
    throw error;
  }
}
const files = output.split('\0').filter(Boolean);
const failures = [];

for (const file of files) {
  if (prohibitedFiles.has(file)) {
    failures.push(`${file}: private planning file must remain untracked`);
    continue;
  }
  if (file === '.env' || file.startsWith('.env.')) {
    failures.push(`${file}: environment file must remain untracked`);
    continue;
  }

  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (contents.includes('\0')) {
    continue;
  }

  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(contents)) {
      failures.push(`${file}: possible ${name}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} candidate files.`);
