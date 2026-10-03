import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDirectory } from './release-scan.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(projectRoot, 'dist', 'release');
const keyFiles = [
  join(projectRoot, 'testdata', 'keys', 'test_public.pem'),
  join(projectRoot, 'testdata', 'keys', 'other_public.pem')
];

if (!existsSync(releaseDir)) {
  console.error('Release build artifact is missing. Run "npm run build:release" first.');
  process.exit(1);
}

const violations = scanDirectory(releaseDir, keyFiles);

if (violations.length > 0) {
  console.error('Release build contains forbidden test material:');
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log('Release build artifact is present and contains no test material.');
