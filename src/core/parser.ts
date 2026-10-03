export type MalformedReason =
  | 'not_decimal'
  | 'too_long'
  | 'not_gzip'
  | 'too_large'
  | 'too_short'
  | 'bad_fields'
  | 'bad_indicator'
  | 'bad_photo'
  | 'bad_dob';

export type VerifyResult =
  | { status: 'pass'; photoCodestream: Uint8Array }
  | { status: 'under_18' }
  | { status: 'bad_signature' }
  | { status: 'malformed'; reason: MalformedReason };

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type AadhaarFields = {
  indicator: string;
  refid: string;
  name: string;
  dob: string;
  gender: string;
  care_of: string;
  district: string;
  landmark: string;
  house: string;
  location: string;
  pincode: string;
  post_office: string;
  state: string;
  street: string;
  sub_district: string;
  vtc: string;
  photo: Uint8Array;
};

const HASH_COUNT_BY_INDICATOR: Record<string, number> = Object.freeze({
  '0': 0,
  '1': 1,
  '2': 1,
  '3': 2
});

const FIELD_NAMES = [
  'indicator',
  'refid',
  'name',
  'dob',
  'gender',
  'care_of',
  'district',
  'landmark',
  'house',
  'location',
  'pincode',
  'post_office',
  'state',
  'street',
  'sub_district',
  'vtc'
] as const;

const SIGNED_BYTES_MIN = 256 + 16 + 4;
const MAX_DECOMPRESSED_BYTES = 64 * 1024;
const DOB_RE = /^\d{2}-\d{2}-\d{4}$/;

export class MalformedError extends Error {
  public readonly reason: MalformedReason;

  public constructor(reason: MalformedReason) {
    super(reason);
    this.name = 'MalformedError';
    this.reason = reason;
  }
}

export function decodeIso8859_1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

export function normalizeDecimalString(digits: string): string {
  const trimmed = digits.trim();
  if (trimmed.length === 0 || !/^[0-9]+$/.test(trimmed)) {
    throw new MalformedError('not_decimal');
  }
  if (trimmed.length > 7089) {
    throw new MalformedError('too_long');
  }
  return trimmed;
}

export function decimalStringToBytes(digits: string): Uint8Array {
  const normalized = normalizeDecimalString(digits);
  const value = BigInt(normalized);
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

export async function gunzipBytes(rawBytes: Uint8Array): Promise<Uint8Array> {
  try {
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
        if (totalLength > MAX_DECOMPRESSED_BYTES) {
          throw new MalformedError('too_large');
        }
        chunks.push(next.value);
      }
    }

    const decompressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      decompressed.set(chunk, offset);
      offset += chunk.length;
    }
    return decompressed;
  } catch (error) {
    if (error instanceof MalformedError) {
      throw error;
    }
    throw new MalformedError('not_gzip');
  }
}

export function parseAadhaarPayload(raw: Uint8Array): AadhaarFields {
  if (raw.length < SIGNED_BYTES_MIN) {
    throw new MalformedError('too_short');
  }

  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < FIELD_NAMES.length; index += 1) {
    const terminatorIndex = raw.indexOf(0xff, start);
    if (terminatorIndex < 0) {
      throw new MalformedError('bad_fields');
    }
    fields.push(decodeIso8859_1(raw.subarray(start, terminatorIndex)));
    start = terminatorIndex + 1;
  }

  const parsedFields = Object.fromEntries(
    FIELD_NAMES.map((fieldName, index) => [fieldName, fields[index]])
  ) as Record<string, string>;

  const indicator = parsedFields.indicator;
  if (!Object.prototype.hasOwnProperty.call(HASH_COUNT_BY_INDICATOR, indicator)) {
    throw new MalformedError('bad_indicator');
  }

  const photoStart = start;
  const hashCount = HASH_COUNT_BY_INDICATOR[indicator];
  const photoEnd = raw.length - 256 - hashCount * 32;
  if (photoEnd <= photoStart) {
    throw new MalformedError('bad_photo');
  }

  const photo = raw.subarray(photoStart, photoEnd);
  if (
    photo.length === 0 ||
    photo[0] !== 0xff ||
    photo[1] !== 0x4f ||
    photo[2] !== 0xff ||
    photo[3] !== 0x51 ||
    photo[photo.length - 2] !== 0xff ||
    photo[photo.length - 1] !== 0xd9
  ) {
    throw new MalformedError('bad_photo');
  }

  return {
    ...parsedFields,
    photo
  } as AadhaarFields;
}

export function normalizeDobString(value: string): { year: number; month: number; day: number } {
  if (!DOB_RE.test(value)) {
    throw new MalformedError('bad_dob');
  }

  const [dayText, monthText, yearText] = value.split('-');
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);

  if (year < 1900) {
    throw new MalformedError('bad_dob');
  }

  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    throw new MalformedError('bad_dob');
  }

  return { year, month, day };
}

export function compareDateParts(left: DateParts, right: DateParts): number {
  const leftKey = left.year * 10000 + left.month * 100 + left.day;
  const rightKey = right.year * 10000 + right.month * 100 + right.day;
  return leftKey - rightKey;
}

export function calculateAge(today: DateParts, dob: DateParts): number {
  const hasBirthdayPassed =
    today.month > dob.month ||
    (today.month === dob.month && today.day >= dob.day);
  return today.year - dob.year - (hasBirthdayPassed ? 0 : 1);
}

export function todayLocal(): DateParts {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

export async function importSpkiPem(pem: string): Promise<CryptoKey> {
  const normalized = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/-----BEGIN RSA PUBLIC KEY-----/g, '')
    .replace(/-----END RSA PUBLIC KEY-----/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .trim();

  const binary = Buffer.from(normalized, 'base64');
  return crypto.subtle.importKey(
    'spki',
    binary,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    true,
    ['verify']
  );
}

export async function verifyAadhaarQr(
  digits: string,
  trustedKey: CryptoKey,
  today: DateParts
): Promise<VerifyResult> {
  try {
    const normalizedDigits = normalizeDecimalString(digits);
    const bigintBytes = decimalStringToBytes(normalizedDigits);
    const raw = await gunzipBytes(bigintBytes);

    if (raw.length < SIGNED_BYTES_MIN) {
      return { status: 'malformed', reason: 'too_short' };
    }

    const signature = raw.subarray(raw.length - 256);
    const signedData = raw.subarray(0, raw.length - 256);

    try {
      const verified = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        trustedKey,
        signature,
        signedData
      );
      if (!verified) {
        return { status: 'bad_signature' };
      }
    } catch {
      return { status: 'bad_signature' };
    }

    const parsed = parseAadhaarPayload(raw);
    const dob = normalizeDobString(parsed.dob);
    if (compareDateParts(today, dob) < 0) {
      throw new MalformedError('bad_dob');
    }

    const age = calculateAge(today, dob);
    if (age >= 18) {
      return { status: 'pass', photoCodestream: parsed.photo };
    }
    return { status: 'under_18' };
  } catch (error) {
    if (error instanceof MalformedError) {
      return { status: 'malformed', reason: error.reason };
    }
    return { status: 'malformed', reason: 'bad_fields' };
  }
}
