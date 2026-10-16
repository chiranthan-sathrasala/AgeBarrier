# AgeBarrier Handoff

## Stage status

- Stage 0 scaffold: done
- Stage 1 core verification: done
- Stage 1 hardening: done
- Stage 1 key rotation: done
- Stage 1 close-out: done
- Stage 1 scan and test hardening: done
- Stage 1 closed; CI green on 6 combinations at `0538c1c`
- Stage 2 QR decoding spike: follow-up complete
- Stage 3 extension shell: not started
- Stage 4 real-certificate tooling: not started
- Stage 5 documentation: not started

## Current-step changes

- Added `jsqr`, `@zxing/library`, `zxing-wasm`, `pngjs`, and `jpeg-js` as development-only spike dependencies.
- Added `scripts/qr-spike.mjs` and the `spike:qr` package script. It reads all 25 manifest QR images plus the dense official sample, compares only pass/fail results, and generates degraded variants in memory.
- Added `docs/QR_DECODER_SPIKE.md` with candidate facts, exact results, CSP/offline findings, and the Stage 3 bundling note.
- Added the dense official sample fixture at `test/fixtures/dense/official_sample_dense.png`.
- No files under `src/`, `testdata/`, or `.github/workflows/ci.yml` were changed.
- BarcodeDetector output is now `not tested` and excluded from totals.
- Confirmed the `@zxing/library` adapter uses one-byte luminance input and `HybridBinarizer`; no adapter fix was needed. Counts remain 13/26 at full size and 18/26 at 50% downscale.
- Added a local `zxing-wasm` initialization check using `prepareZXingModule({ wasmBinary })` with `fetch` replaced by a throwing function. It decoded 26/26; the exported reader WASM SHA-256 is `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`.
- Documented that the browser default fetches WASM from jsDelivr and that Stage 3 must override it locally.

## Validation

- `npm test`: passed, 1 test file and 39 tests.
- Manifest cases exercised: 25.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run check:no-network`: passed.
- `npm run build:release`: failed as required with `Release build blocked: config/uidai_spki.pem is required.`
- After deleting `dist/`, `npm run check:release-clean`: failed as required with `Release build artifact is missing. Run "npm run build:release" first.`
- `npm run build:test`: passed and produced only `dist/test/agebarrier.js` and `dist/test/agebarrier.js.map`; no `dist/release` exists.
- `npm run spike:qr`: passed as an informational report; zxing-wasm decoded 26/26, jsQR 23/26, and @zxing/library 13/26.
- Local WASM check: passed 26/26 while network fetch was disabled.

## Decisions

- All decoder packages remain in `devDependencies`; nothing was imported from `src/`.
- zxing-wasm is recommended because it is the only tested candidate with 26/26 exact matches. Its extension use requires locally packaging the matching WASM and adding `wasm-unsafe-eval` to the MV3 extension-pages CSP.
- BarcodeDetector was not tested in Node and remains a manual Chrome-extension TODO.
- Owner approval is required for `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`, because AGENTS.md bans eval and MV3 requires this WASM exception.
- `build:release` remains fail-closed until a valid, non-test UIDAI SPKI PEM is supplied.

## Open TODO(question)

- Obtain owner approval for the MV3 `wasm-unsafe-eval` exception, then manually test BarcodeDetector and locally packaged zxing-wasm in the target Chrome extension page.
- Add and validate `config/uidai_spki.pem` only when the real UIDAI certificate is supplied.
- Implement `scripts/verify-real-qr.mjs`.
- Implement the runtime device key and credential/embedding storage flow.

## Known failures or unfinished work

- `npm run check:release-clean` currently fails because no `dist/release` exists; this is expected after the required test-only lifecycle check.
- Browser extension-page loading and manual BarcodeDetector behavior remain unverified.

## Next action

Obtain approval for the MV3 WASM CSP exception before Stage 3.
