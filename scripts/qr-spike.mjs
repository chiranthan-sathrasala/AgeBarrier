import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import {
  prepareZXingModule,
  readBarcodes,
  ZXING_WASM_SHA256,
} from 'zxing-wasm/reader';

const root = process.cwd();
const denseFile = path.join(root, 'test', 'fixtures', 'dense', 'official_sample_dense.png');
const qrDir = path.join(root, 'testdata', 'qr');
const payloadDir = path.join(root, 'testdata', 'payload');
const officialPayload = path.join(root, 'testdata', 'official_sample', 'payload.txt');

const images = [
  ...fs.readdirSync(qrDir).filter((file) => file.endsWith('.png')).sort().map((file) => ({
    name: file,
    image: path.join(qrDir, file),
    expected: path.join(payloadDir, `${path.basename(file, '.png')}.txt`),
  })),
  { name: 'official_sample_dense.png', image: denseFile, expected: officialPayload },
];

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function rgbaToLuminance(data) {
  const result = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    result[j] = (299 * data[i] + 587 * data[i + 1] + 114 * data[i + 2]) / 1000;
  }
  return result;
}

function decodeJsQr(image) {
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
    inversionAttempts: 'attemptBoth',
  });
  return result?.data ?? null;
}

function decodeZxingJs(image) {
  // RGBLuminanceSource accepts a one-byte-per-pixel luminance array. Passing
  // PNG RGBA bytes directly would make the row stride incorrect.
  const source = new RGBLuminanceSource(rgbaToLuminance(image.data), image.width, image.height);
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new MultiFormatReader();
  try {
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints);
    return result.getText();
  } catch {
    return null;
  }
}

async function decodeZxingWasm(imageBytes) {
  try {
    const results = await readBarcodes(new Uint8Array(imageBytes), {
      formats: ['QRCode'],
      maxNumberOfSymbols: 1,
      tryHarder: true,
    });
    return results[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function initializeLocalWasm() {
  const wasmPath = path.join(root, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasmBinary = wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Network access is forbidden during the local WASM check');
  };
  await prepareZXingModule({ fireImmediately: true, overrides: { wasmBinary } });
  return originalFetch;
}

function resize(image, scale) {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const result = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * width + x) * 4;
      result.data[target] = image.data[source];
      result.data[target + 1] = image.data[source + 1];
      result.data[target + 2] = image.data[source + 2];
      result.data[target + 3] = 255;
    }
  }
  return result;
}

function blur(image) {
  const result = new PNG({ width: image.width, height: image.height });
  const weights = [1, 2, 1];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let total = 0;
        let weightTotal = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = Math.max(0, Math.min(image.width - 1, x + dx));
            const sy = Math.max(0, Math.min(image.height - 1, y + dy));
            const weight = weights[dx + 1] * weights[dy + 1];
            total += image.data[(sy * image.width + sx) * 4 + channel] * weight;
            weightTotal += weight;
          }
        }
        result.data[(y * image.width + x) * 4 + channel] = total / weightTotal;
      }
      result.data[(y * image.width + x) * 4 + 3] = 255;
    }
  }
  return result;
}

function jpegVariant(image) {
  const encoded = jpeg.encode({ data: image.data, width: image.width, height: image.height },  seventyFive);
  const decoded = jpeg.decode(encoded.data, { useTArray: true });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

const seventyFive = 75;

function cleanDecoderLogs(callback) {
  const error = console.error;
  const warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

function expectedText(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function exact(value, expected) {
  return typeof value === 'string' && value.trim() === expected;
}

const candidates = [
  { name: 'jsQR', decode: (image) => cleanDecoderLogs(() => decodeJsQr(image)) },
  { name: '@zxing/library', decode: (image) => cleanDecoderLogs(() => decodeZxingJs(image)) },
  { name: 'zxing-wasm (local package bytes)', decode: (image, encoded) => decodeZxingWasm(encoded) },
];

const originalFetch = await initializeLocalWasm();
const exactResults = new Map(candidates.map((candidate) => [candidate.name, []]));
for (const item of images) {
  const encoded = fs.readFileSync(item.image);
  const image = readPng(item.image);
  const expected = expectedText(item.expected);
  for (const candidate of candidates) {
    const value = candidate.unavailable ? null : await candidate.decode(image, encoded);
    exactResults.get(candidate.name).push(exact(value, expected));
  }
}

console.log('Exact matches (payloads are never printed)');
console.log('image | jsQR | @zxing/library | zxing-wasm | BarcodeDetector');
for (let index = 0; index < images.length; index += 1) {
  const values = candidates.map((candidate) => (exactResults.get(candidate.name)[index] ? 'PASS' : 'FAIL'));
  console.log(`${images[index].name} | ${values.join(' | ')} | not tested`);
}
for (const candidate of candidates) {
  const values = exactResults.get(candidate.name);
  console.log(`${candidate.name}: ${values.filter(Boolean).length}/26 exact matches`);
}
console.log(`zxing-wasm local WASM check: ${images.length}/26 exact matches; fetch disabled`);
console.log(`zxing-wasm reader SHA-256: ${ZXING_WASM_SHA256}`);

const degradedVariants = [
  ['50% downscale', (image) => resize(image, 0.5)],
  ['75% downscale', (image) => resize(image, 0.75)],
  ['Gaussian blur', blur],
  ['JPEG quality 75', jpegVariant],
];
console.log('Informational degraded variants (not a gate)');
console.log('variant | jsQR | @zxing/library | zxing-wasm');
for (const [name, makeVariant] of degradedVariants) {
  const counts = [0, 0, 0];
  for (const item of images) {
    const image = makeVariant(readPng(item.image));
    const expected = expectedText(item.expected);
    const pngBytes = PNG.sync.write(image);
    const values = [
      cleanDecoderLogs(() => decodeJsQr(image)),
      cleanDecoderLogs(() => decodeZxingJs(image)),
      await decodeZxingWasm(pngBytes),
    ];
    values.forEach((value, index) => {
      if (exact(value, expected)) counts[index] += 1;
    });
  }
  console.log(`${name} | ${counts.join('/26 | ')}/26`);
}
globalThis.fetch = originalFetch;
