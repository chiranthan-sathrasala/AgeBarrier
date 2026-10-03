# AgeBarrier Handoff

## Stage status

- Stage 0 scaffold: done
- Stage 1 core verification: done
- Stage 1 hardening: done
- Stage 1 key rotation: done
- Stage 1 close-out: in progress
- Stage 2 QR decoding spike: not started
- Stage 3 extension shell: not started
- Stage 4 real-certificate tooling: not started
- Stage 5 documentation: not started

## Baseline before this close-out

- Command: `npm test`
- Result: passed, 1 test file and 33 tests on the current Node runtime.

## Current-step changes

- `src/core/parser.ts`: verified the gunzip writer receives the required Uint8Array view:
  `await writer.write(rawBytes as Uint8Array<ArrayBuffer>)`.
- `test/core.spec.ts`: added manifest IDs to generated test titles, explicit malformed-reason assertions, and the `adult_25` decompression canary.
- `scripts/build-release.mjs`: added a clear release-build failure when `config/uidai_spki.pem` is absent.
- `scripts/check-release-clean.mjs`: added checks for the test public-key base64 body and the string `testdata`.
- `package.json`: routed `build:release` through the UIDAI-key gate.
- `AGENTS.md`: added the repository standing rules.
- `.nvmrc`: added Node version `22`.
- `.github/workflows/ci.yml`: added the Node 20/22 Ubuntu/Windows CI checks.
- `docs/DESIGN.md`: added the accepted device-clock limitation to the threat table and limitations.
- `docs/HANDOFF.md`: rewritten from current facts.

## Validation

- `npm test`: passed, 1 test file and 35 tests
- Manifest cases exercised: 25
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run check:no-network`: passed
- `npm run check:release-clean`: passed; `dist/release` exists and contains neither the test public-key base64 body nor `testdata`
- `npm run build:release`: failed as required with `Release build blocked: config/uidai_spki.pem is required.`
- The final test run was on the current Node runtime; Node 20/22 matrix execution is defined in CI but was not run locally.

## Decisions

- No UIDAI public key was added.
- `testdata/` was not modified.
- Release builds fail closed until the real UIDAI SPKI file is supplied.
- Release cleanliness checks read the test public-key base64 body from `testdata/keys/test_public.pem` and reject it, plus any `testdata` string, from `dist/release`.
- The earlier “all passing” report did not reproduce on Node 22 because the gzip writer accepted an incompatible ArrayBuffer type; the fix is now verified in `src/core/parser.ts` and covered by the decompression canary. This session did not independently run Node 22 locally.

## Open TODO(question)

- Add and validate `config/uidai_spki.pem` only when the real UIDAI certificate is supplied.
- Implement `scripts/verify-real-qr.mjs`.
- Implement the runtime device key and credential/embedding storage flow.

## Known failures or unfinished work

- `npm run build:release` intentionally fails until `config/uidai_spki.pem` exists.
- Stage 2 and later stages are not started.

## Next action

Review the Stage 1 close-out commit before starting Stage 2.
