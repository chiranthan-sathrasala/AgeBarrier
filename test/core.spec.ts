import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  importSpkiPem,
  parseAadhaarPayload,
  verifyAadhaarQr
} from '../src/core/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const testdataRoot = join(projectRoot, 'testdata');
const manifestPath = join(testdataRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  today: string;
  trusted_public_key: string;
  cases: Array<{
    id: string;
    expected: string;
    payload: string;
  }>;
};

function decimalStringToBytes(digits: string): Uint8Array {
  const trimmed = digits.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error('not_decimal');
  }

  const value = BigInt(trimmed);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const start = index * 2;
    bytes[index] = Number.parseInt(hex.slice(start, start + 2), 16);
  }
  return bytes;
}

async function gunzipBytes(rawBytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(rawBytes);
  await writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    if (next.value !== undefined) {
      totalLength += next.value.byteLength;
      chunks.push(next.value);
    }
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function readJ2kDimensions(photo: Uint8Array): { width: number; height: number } {
  if (
    photo.length < 12 ||
    photo[0] !== 0xff ||
    photo[1] !== 0x4f ||
    photo[2] !== 0xff ||
    photo[3] !== 0x51
  ) {
    throw new Error('bad_photo');
  }

  const width = ((photo[8] << 24) | (photo[9] << 16) | (photo[10] << 8) | photo[11]) >>> 0;
  const height = ((photo[12] << 24) | (photo[13] << 16) | (photo[14] << 8) | photo[15]) >>> 0;

  return { width, height };
}

describe('AgeBarrier verification', () => {
  for (const testCase of manifest.cases) {
    it(testCase.id, async () => {
      const payloadPath = join(testdataRoot, testCase.payload);
      const payload = readFileSync(payloadPath, 'utf8').trim();
      const pemPath = join(testdataRoot, manifest.trusted_public_key);
      const key = await importSpkiPem(readFileSync(pemPath, 'utf8'));
      const result = await verifyAadhaarQr(payload, key, { year: 2026, month: 10, day: 2 });

      if (testCase.id === 'truncated_sig') {
        expect(['bad_signature', 'malformed']).toContain(result.status);
        if (result.status === 'malformed') {
          expect(typeof result.reason).toBe('string');
        }
        return;
      }

      expect(result.status).toBe(testCase.expected);
      if (result.status === 'malformed') {
        expect(typeof result.reason).toBe('string');
      }
    });
  }

  it('deep-import parser accepts the official UIDAI sample', async () => {
    const samplePayload = readFileSync(join(testdataRoot, 'official_sample', 'payload.txt'), 'utf8').trim();
    const raw = await gunzipBytes(decimalStringToBytes(samplePayload));
    const parsed = parseAadhaarPayload(raw);
    const fields = { ...parsed };
    delete fields.photo;

    expect(Object.keys(fields)).toHaveLength(16);
    expect(parsed.indicator).toBe('2');
    const dimensions = readJ2kDimensions(parsed.photo);
    expect(dimensions.width).toBe(60);
    expect(dimensions.height).toBe(60);
  });
});
