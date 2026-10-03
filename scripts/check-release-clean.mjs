import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(projectRoot, 'dist', 'release');
const publicKeyPath = join(projectRoot, 'testdata', 'keys', 'test_public.pem');

if (!existsSync(releaseDir)) {
  console.error('Release build artifact is missing. Run "npm run build:release" first.');
  process.exit(1);
}

const publicKey = readFileSync(publicKeyPath, 'utf8');
const publicKeyBody = publicKey
  .replace('-----BEGIN PUBLIC KEY-----', '')
  .replace('-----END PUBLIC KEY-----', '')
  .replace(/\s/g, '');

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

const violations = [];
for (const filePath of filesUnder(releaseDir)) {
  const content = readFileSync(filePath, 'utf8');
  if (content.includes(publicKeyBody)) {
    violations.push(`${filePath}: test public key material`);
  }
  if (content.includes('testdata')) {
    violations.push(`${filePath}: testdata reference`);
  }
}

if (violations.length > 0) {
  console.error('Release build contains forbidden test material:');
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log('Release build artifact is present and contains no test material.');
