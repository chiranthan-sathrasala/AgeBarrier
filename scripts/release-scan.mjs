import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function normalizeContent(content) {
  return content
    .replaceAll('\\n', '')
    .replaceAll('\\r', '')
    .replace(/\s/g, '');
}

function keyPatterns(keyFile) {
  const pem = readFileSync(keyFile, 'utf8');
  const lines = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const body = lines.join('');
  const innerSlices = lines.slice(1, -1).map((line) => line.slice(0, 40));
  return [body, ...innerSlices];
}

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

export function scanDirectory(directory, keyFiles) {
  const patterns = keyFiles.flatMap(keyPatterns);
  const violations = [];

  for (const filePath of filesUnder(directory)) {
    const content = normalizeContent(readFileSync(filePath, 'utf8'));
    if (content.includes('testdata')) {
      violations.push(`${filePath}: testdata reference`);
    }
    for (const pattern of patterns) {
      if (pattern.length > 0 && content.includes(pattern)) {
        violations.push(`${filePath}: test public key material`);
        break;
      }
    }
  }

  return violations;
}
