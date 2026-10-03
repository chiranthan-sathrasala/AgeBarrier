# AgeBarrier Handoff

## Stage status

- Stage 0 scaffold: done
- Stage 1 core verification: done
- Stage 1 hardening: done
- Stage 1 key rotation: done
- Stage 1 close-out: done
- Stage 1 scan and test hardening: done
- Stage 2 QR decoding spike: not started
- Stage 3 extension shell: not started
- Stage 4 real-certificate tooling: not started
- Stage 5 documentation: not started

## Current-step changes

- Added `scripts/release-scan.mjs` with exported `scanDirectory(dir, keyFiles)`.
- Moved release scanning out of `scripts/check-release-clean.mjs`.
- Release scanning now normalizes literal `\n` and `\r` sequences and whitespace, then checks both fixture public-key bodies, inner-line 40-character slices, and `testdata`.
- `scripts/build-release.mjs` now rejects empty, malformed, invalid-base64, or test-key-matching `config/uidai_spki.pem` values with distinct messages.
- Added release-scan, entry-point export, key-algorithm guard, and malformed-SPKI tests.
- Updated CI permissions, fail-fast behavior, Node matrix, and test-build step.
- Added `scripts/release-scan.d.mts` for strict TypeScript checking of the test import.
- Rewrote this handoff from current facts.

## Validation

- Baseline `npm test`: passed, 1 test file and 35 tests.
- Final `npm test`: passed, 1 test file and 39 tests.
- Manifest cases exercised: 25.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run check:no-network`: passed.
- `npm run build:release`: failed as required with `Release build blocked: config/uidai_spki.pem is required.`
- After deleting `dist/`, `npm run check:release-clean`: failed with the missing-release-artifact message.
- `npm run build:test`: passed and produced only `dist/test/agebarrier.js` and its source map.
- After the test-only build, `npm run check:release-clean`: failed because `dist/release` was absent.

## Decisions

- No files under `testdata/` were changed.
- No UIDAI key was added.
- `dist/` was deleted for the required lifecycle check and recreated only as `dist/test`.
- Release scanning checks both test public keys because either fixture key must not enter a release artifact.
- `build:release` remains fail-closed until a valid, non-test UIDAI SPKI PEM is supplied.

## Open TODO(question)

- Add and validate `config/uidai_spki.pem` only when the real UIDAI certificate is supplied.
- Implement `scripts/verify-real-qr.mjs`.
- Implement the runtime device key and credential/embedding storage flow.

## Known failures or unfinished work

- `npm run check:release-clean` currently fails because no `dist/release` exists; this is expected after the required test-only lifecycle check.
- Stage 2 and later stages are not started.

## Next action

Push this commit, then check the CI matrix results.
