import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const uidaiKeyPath = join(projectRoot, 'config', 'uidai_spki.pem');
const testKeyPaths = [
  join(projectRoot, 'testdata', 'keys', 'test_public.pem'),
  join(projectRoot, 'testdata', 'keys', 'other_public.pem')
];

if (!existsSync(uidaiKeyPath)) {
  console.error('Release build blocked: config/uidai_spki.pem is required.');
  process.exit(1);
}

const uidaiPem = readFileSync(uidaiKeyPath, 'utf8');
if (uidaiPem.trim().length === 0) {
  console.error('Release build blocked: config/uidai_spki.pem is empty.');
  process.exit(1);
}

const pemMatch = uidaiPem.match(/^\s*-----BEGIN PUBLIC KEY-----([\s\S]+)-----END PUBLIC KEY-----\s*$/);
if (pemMatch === null) {
  console.error('Release build blocked: config/uidai_spki.pem must contain a PUBLIC KEY PEM pair.');
  process.exit(1);
}

const uidaiBody = pemMatch[1].replace(/\s/g, '');
if (
  uidaiBody.length === 0 ||
  uidaiBody.length % 4 !== 0 ||
  !/^[A-Za-z0-9+/]*={0,2}$/.test(uidaiBody)
) {
  console.error('Release build blocked: config/uidai_spki.pem contains invalid base64.');
  process.exit(1);
}

for (const testKeyPath of testKeyPaths) {
  const testPem = readFileSync(testKeyPath, 'utf8');
  const testMatch = testPem.match(/^\s*-----BEGIN PUBLIC KEY-----([\s\S]+)-----END PUBLIC KEY-----\s*$/);
  if (testMatch !== null && testMatch[1].replace(/\s/g, '') === uidaiBody) {
    console.error('Release build blocked: config/uidai_spki.pem matches a test public key.');
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'release'], {
  cwd: projectRoot,
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
