import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { importSpkiPem, verifyAadhaarQr } from '../src/core/index';
import { scanDirectory } from '../scripts/release-scan.mjs';
import {
  calculateAge,
  decodeIso8859_1,
  decimalStringToBytes,
  gunzipBytes,
  normalizeDobString,
  parseAadhaarPayload
} from '../src/core/parser';

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

function parseManifestDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function bytesToDecimalString(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return BigInt(`0x${hex || '0'}`).toString(10);
}

function readJ2kDimensions(photo: Uint8Array): { width: number; height: number } {
  if (
    photo.length < 16 ||
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

async function loadTrustedKey(): Promise<CryptoKey> {
  const pemPath = join(testdataRoot, manifest.trusted_public_key);
  return importSpkiPem(readFileSync(pemPath, 'utf8'));
}

describe('AgeBarrier verification', () => {
  it('exposes only the intended runtime entry-point exports', async () => {
    const entryPoint = await import('../src/core/index');
    expect(Object.keys(entryPoint).sort()).toEqual(['importSpkiPem', 'todayLocal', 'verifyAadhaarQr']);
  });

  it('uses a manifest with at least 25 cases', () => {
    expect(manifest.cases.length).toBeGreaterThanOrEqual(25);
  });

  for (const testCase of manifest.cases) {
    it(`verifies manifest case ${testCase.id} without exposing document data`, async () => {
      const payload = readFileSync(join(testdataRoot, testCase.payload), 'utf8').trim();
      const result = await verifyAadhaarQr(payload, await loadTrustedKey(), parseManifestDate(manifest.today));

      if (testCase.id === 'truncated_sig') {
        expect(['bad_signature', 'malformed']).toContain(result.status);
      } else {
        expect(result.status).toBe(testCase.expected);
      }

      if (result.status === 'pass') {
        expect(Object.keys(result).sort()).toEqual(['photoCodestream', 'status']);
        expect(Array.from(result.photoCodestream.slice(0, 4))).toEqual([0xff, 0x4f, 0xff, 0x51]);
      } else if (result.status === 'malformed') {
        expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
      } else {
        expect(Object.keys(result)).toEqual(['status']);
      }
    });
  }

  // Deliberate exception to the rule that expected results come from manifest.json:
  // these assertions lock down the public malformed-reason contract for named cases.
  it('preserves the documented malformed reasons', async () => {
    const expectedReasons: Record<string, { status: 'malformed'; reason: string }> = {
      bad_indicator: { status: 'malformed', reason: 'bad_indicator' },
      bad_dob_format: { status: 'malformed', reason: 'bad_dob' },
      future_dob: { status: 'malformed', reason: 'bad_dob' },
      not_gzip: { status: 'malformed', reason: 'not_gzip' },
      garbage_digits: { status: 'malformed', reason: 'not_gzip' }
    };

    for (const [id, expected] of Object.entries(expectedReasons)) {
      const testCase = manifest.cases.find((candidate) => candidate.id === id);
      expect(testCase).toBeDefined();
      const payload = readFileSync(join(testdataRoot, testCase!.payload), 'utf8').trim();
      expect(await verifyAadhaarQr(payload, await loadTrustedKey(), parseManifestDate(manifest.today)))
        .toEqual(expected);
    }
  });

  it('canaries the adult_25 decompressed prefix', async () => {
    const testCase = manifest.cases.find((candidate) => candidate.id === 'adult_25');
    expect(testCase).toBeDefined();
    const payload = readFileSync(join(testdataRoot, testCase!.payload), 'utf8').trim();
    const raw = await gunzipBytes(decimalStringToBytes(payload));
    expect(raw[0]).toBe('2'.charCodeAt(0));
    expect(raw[1]).toBe(0xff);
  });

  it('rejects keys with unsupported algorithm parameters', async () => {
    const testCase = manifest.cases.find((candidate) => candidate.id === 'adult_25');
    expect(testCase).toBeDefined();
    const payload = readFileSync(join(testdataRoot, testCase!.payload), 'utf8').trim();
    const pem = readFileSync(join(testdataRoot, manifest.trusted_public_key), 'utf8');
    const body = pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const binary = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
    const sha1Key = await crypto.subtle.importKey(
      'spki',
      binary,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
      false,
      ['verify']
    );
    expect(await verifyAadhaarQr(payload, sha1Key, parseManifestDate(manifest.today)))
      .toEqual({ status: 'bad_signature' });

    const weakPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      false,
      ['sign', 'verify']
    );
    expect(await verifyAadhaarQr(payload, weakPair.publicKey, parseManifestDate(manifest.today)))
      .toEqual({ status: 'bad_signature' });
  });

  it('rejects malformed SPKI PEM inputs', async () => {
    const testCases = [
      '',
      'garbage',
      '-----BEGIN RSA PUBLIC KEY-----\nAAAA\n-----END RSA PUBLIC KEY-----',
      '-----BEGIN PUBLIC KEY-----\n%%%invalid%%%\n-----END PUBLIC KEY-----',
      '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'
    ];
    for (const pem of testCases) {
      await expect(importSpkiPem(pem)).rejects.toThrow();
    }
  });

  it('parses the official sample and rejects it with the test key', async () => {
    const samplePayload = readFileSync(join(testdataRoot, 'official_sample', 'payload.txt'), 'utf8').trim();
    const raw = await gunzipBytes(decimalStringToBytes(samplePayload));
    const parsed = parseAadhaarPayload(raw);
    const { photo, ...fields } = parsed;

    expect(Object.keys(fields)).toHaveLength(16);
    expect(parsed.indicator).toBe('2');
    expect(photo).toHaveLength(883);
    expect(readJ2kDimensions(photo)).toEqual({ width: 60, height: 60 });
    expect((await verifyAadhaarQr(samplePayload, await loadTrustedKey(), parseManifestDate(manifest.today))).status)
      .toBe('bad_signature');
  });

  it('checks the signature before parsing structurally broken data', async () => {
    const payload = readFileSync(join(testdataRoot, 'payload', 'adult_25.txt'), 'utf8').trim();
    const raw = await gunzipBytes(decimalStringToBytes(payload));
    raw[0] = 0x37;
    const mutatedPayload = bytesToDecimalString(gzipSync(raw));

    expect((await verifyAadhaarQr(mutatedPayload, await loadTrustedKey(), parseManifestDate(manifest.today))).status)
      .toBe('bad_signature');

    for (const id of ['bad_indicator', 'bad_dob_format', 'future_dob']) {
      const testCase = manifest.cases.find((candidate) => candidate.id === id);
      expect(testCase).toBeDefined();
      const validlySignedMalformed = readFileSync(join(testdataRoot, testCase!.payload), 'utf8').trim();
      const result = await verifyAadhaarQr(validlySignedMalformed, await loadTrustedKey(), parseManifestDate(manifest.today));
      expect(result.status).toBe('malformed');
    }
  });

  it('maps every byte through ISO-8859-1 directly', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const decoded = decodeIso8859_1(bytes);
    expect(decoded.length).toBe(256);
    for (let index = 0; index < 256; index += 1) {
      expect(decoded.charCodeAt(index)).toBe(index);
    }
    expect(decoded.charCodeAt(0xe9)).toBe(0xe9);
    expect(decoded.charCodeAt(0xd1)).toBe(0xd1);
  });

  it('calculates injected-date ages at boundaries', () => {
    expect(calculateAge({ year: 2026, month: 2, day: 28 }, { year: 2008, month: 2, day: 29 })).toBe(17);
    expect(calculateAge({ year: 2026, month: 3, day: 1 }, { year: 2008, month: 2, day: 29 })).toBe(18);
    expect(calculateAge({ year: 2026, month: 10, day: 2 }, { year: 2008, month: 10, day: 2 })).toBe(18);
    expect(calculateAge({ year: 2026, month: 10, day: 2 }, { year: 2008, month: 10, day: 3 })).toBe(17);
    expect(calculateAge({ year: 2026, month: 1, day: 1 }, { year: 2008, month: 1, day: 1 })).toBe(18);
    expect(calculateAge({ year: 2026, month: 12, day: 31 }, { year: 2008, month: 12, day: 31 })).toBe(18);
  });

  it('validates DOBs with Gregorian calendar rules', () => {
    for (const value of ['31-02-2009', '29-02-2009', '00-01-2000', '01-13-2000', '01-01-1899', '1990/01/01', ' 01-01-1990']) {
      expect(() => normalizeDobString(value)).toThrow();
    }
    expect(normalizeDobString('29-02-2008')).toEqual({ year: 2008, month: 2, day: 29 });
    expect(normalizeDobString('29-02-2000')).toEqual({ year: 2000, month: 2, day: 29 });
  });

  it('rejects hostile inputs with exact reasons', async () => {
    const key = await loadTrustedKey();
    const today = parseManifestDate(manifest.today);
    const cases: Array<[string, string]> = [
      ['', 'not_decimal'],
      ['   ', 'not_decimal'],
      ['12a4', 'not_decimal'],
      ['1'.repeat(7090), 'too_long'],
      ['1'.repeat(7089), 'not_gzip'],
      ['0', 'not_gzip']
    ];

    for (const [digits, reason] of cases) {
      const result = await verifyAadhaarQr(digits, key, today);
      expect(result).toEqual({ status: 'malformed', reason });
    }

    const shortGzip = bytesToDecimalString(gzipSync(new Uint8Array(10)));
    expect(await verifyAadhaarQr(shortGzip, key, today)).toEqual({ status: 'malformed', reason: 'too_short' });

    const bombGzip = bytesToDecimalString(gzipSync(new Uint8Array(1024 * 1024)));
    expect(bombGzip.length).toBeLessThanOrEqual(7089);
    expect(await verifyAadhaarQr(bombGzip, key, today)).toEqual({ status: 'malformed', reason: 'too_large' });
  });

  it('keeps src/core dependency-free and free of prohibited APIs', () => {
    const coreRoot = join(projectRoot, 'src', 'core');
    const files = readdirSync(coreRoot, { recursive: true, encoding: 'utf8' })
      .filter((file): file is string => file.endsWith('.ts'));
    const forbidden = /chrome\.|\bBuffer\b|process\.|require\(|console\.|eval\(|fetch\(|XMLHttpRequest/;

    for (const file of files) {
      const fullPath = join(coreRoot, file);
      const source = readFileSync(fullPath, 'utf8');
      expect(source).not.toMatch(forbidden);
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const importedPath of imports) {
        expect(importedPath.startsWith('.')).toBe(true);
        expect(resolve(fullPath, '..', importedPath)).toContain(resolve(coreRoot));
      }
    }
  });
});

describe('Release scanning', () => {
  it('flags embedded test public keys and testdata references', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agebarrier-release-scan-'));
    try {
      const testPem = readFileSync(join(testdataRoot, 'keys', 'test_public.pem'), 'utf8');
      const otherPem = readFileSync(join(testdataRoot, 'keys', 'other_public.pem'), 'utf8');
      const testBody = testPem
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s/g, '');
      writeFileSync(join(directory, 'json.txt'), JSON.stringify(testPem));
      writeFileSync(join(directory, 'other-json.txt'), JSON.stringify(otherPem));
      writeFileSync(join(directory, 'body.txt'), testBody);
      writeFileSync(join(directory, 'clean.txt'), 'release content only');
      writeFileSync(join(directory, 'word.txt'), 'testdata');

      const violations = scanDirectory(directory, [
        join(testdataRoot, 'keys', 'test_public.pem'),
        join(testdataRoot, 'keys', 'other_public.pem')
      ]);
      expect(violations.some((violation) => violation.includes('json.txt'))).toBe(true);
      expect(violations.some((violation) => violation.includes('other-json.txt'))).toBe(true);
      expect(violations.some((violation) => violation.includes('body.txt'))).toBe(true);
      expect(violations.some((violation) => violation.includes('word.txt'))).toBe(true);
      expect(violations.some((violation) => violation.includes('clean.txt'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
