import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(projectRoot, 'dist', 'release');

if (!existsSync(releaseDir)) {
  console.error('Release build artifact is missing. Run "npm run build:release" first.');
  process.exit(1);
}

console.log('Release build artifact present.');
