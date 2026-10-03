import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(rootDir, '..');
const srcDir = join(projectRoot, 'src');

const forbiddenPatterns = ['fetch(', 'XMLHttpRequest', 'new WebSocket(', 'navigator.sendBeacon('];

const visited = new Set();

function walk(currentDir) {
  if (!existsSync(currentDir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

const matches = [];
for (const file of walk(srcDir)) {
  if (!file.endsWith('.ts') && !file.endsWith('.js') && !file.endsWith('.mjs')) {
    continue;
  }
  visited.add(file);
  const content = readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      matches.push({ file, pattern });
    }
  }
}

if (matches.length > 0) {
  console.error('Network access pattern found:');
  for (const match of matches) {
    console.error(`${match.file}: ${match.pattern}`);
  }
  process.exit(1);
}

console.log('No direct network access patterns found in src/.');
