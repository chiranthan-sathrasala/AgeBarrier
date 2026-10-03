import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const uidaiKeyPath = join(projectRoot, 'config', 'uidai_spki.pem');

if (!existsSync(uidaiKeyPath)) {
  console.error('Release build blocked: config/uidai_spki.pem is required.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'release'], {
  cwd: projectRoot,
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
