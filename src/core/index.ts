export type { AadhaarFields, DateParts, MalformedReason, VerifyResult } from './parser';
export {
  calculateAge,
  compareDateParts,
  decodeIso8859_1,
  decimalStringToBytes,
  gunzipBytes,
  importSpkiPem,
  MalformedError,
  normalizeDecimalString,
  normalizeDobString,
  parseAadhaarPayload,
  todayLocal,
  verifyAadhaarQr
} from './parser';
