# AgeBarrier Handoff

## Stage status

- Stage 0 scaffold: done
- Stage 1 core verification: done
- Ignore and attributes configuration: done
- Stage 1 hardening: done
- Stage 1 key rotation and hardening verification: done

## Validation

- `npm test`: passed, 1 test file and 33 tests
- `npm run lint`: passed
- `npm run typecheck`: passed
- Stage 1 follow-up `npm test`: passed, 1 test file and 33 tests
- Stage 1 follow-up `npm run lint`: passed
- Stage 1 follow-up `npm run typecheck`: passed
- `npm run build:test`: passed
- `npm run build:release`: passed, Vite emitted `dist/release/agebarrier.js`
- `npm run check:no-network`: passed
- `npm run check:release-clean`: passed
- Ignore verification: passed for all required ignored and non-ignored paths
- `git ls-files -ci --exclude-standard`: reported 2 tracked private test keys

## Current step files

- `.gitignore`: created
- `.gitattributes`: created
- `docs/PHASE1.md`: created with data-safety guidance
- `docs/HANDOFF.md`: updated for Stage 1 hardening
- `src/core/parser.ts`: hardened streaming, key import, algorithm checks, and DOB validation
- `src/core/index.ts`: narrowed public exports
- `test/core.spec.ts`: expanded manifest, hostile-input, ordering, Latin-1, age, DOB, and static checks
- `eslint.config.mjs`: added core restrictions for Node globals and console
- `package.json`: added the `typecheck` script
- `testdata/keys/test_public.pem`: rotated
- `testdata/keys/other_public.pem`: rotated
- `testdata/payload/*.txt`: re-signed for all 25 manifest cases
- `testdata/qr/*.png`: regenerated for rotated payloads
- `testdata/manifest.json`: preserved case metadata and updated payload digit lengths

## Decisions

- Ignored the actual Vite output root `dist/`, plus the requested build/cache directories.
- Ignored test private keys, while leaving already tracked private-key fixtures untouched because the task explicitly forbids untracking tracked files under `testdata/`.
- Kept `package-lock.json`, public test fixtures, public keys, documentation, and project rules addable.
- The Stage 1 hardening changes were committed as `5c428e3`; no push was performed.
- Kept parser helpers exported only through the deep test path and marked them `internal, for tests only`; the package entry point exposes only the requested API.
- Imported SPKI keys as non-extractable verify-only keys and rejected trusted keys whose algorithm metadata is not RSA-2048/SHA-256.
- Used concurrent decompression reading/writing with cancellation and writer abort on failure.
- Generated fresh RSA-2048 fixture key pairs with Node crypto; old private-key material was removed from the working tree before generation.
- Re-signed all 25 cases while preserving fields, expected outcomes, and mutations; forged and tampered cases remain invalid relative to the new trusted key.
- Confirmed no runtime device-key generation, embedding/credential signing, or storage implementation exists yet. The current extension shell is only `src/extension/index.ts`; test fixture keys and runtime device keys therefore cannot currently share material or storage.
- Confirmed `importSpkiPem` has only the SPKI `BEGIN PUBLIC KEY` branch; no RSA PKCS#1 branch remains.
- Confirmed the official-sample dimension helper requires 16 bytes and is exercised by the official-sample test.
- Confirmed the static core test checks all eight prohibited patterns: `chrome.`, `Buffer`, `process.`, `require(`, `console.`, `eval(`, `fetch(`, and `XMLHttpRequest`.
- Confirmed the gzip bomb is 1,048,576 decompressed bytes, 2,531 decimal digits, and therefore within the 7,089-digit input limit.

## Open TODO(question)

- Confirm the future location and behavior of `scripts/verify-real-qr.mjs`.
- Confirm whether the runtime environment should provide `atob` independently of browser APIs.
- Implement the runtime device key and credential/embedding storage flow in the extension stages; separation from fixture signing keys can then be verified against concrete files.

## Known failures or unfinished work

- `docs/PHASE1.md` references `scripts/verify-real-qr.mjs`, which does not exist yet and is outside this step's scope.
- No known failures remain for the Stage 1 hardening scope.
- Runtime device-key separation is not yet implementable because the runtime key flow does not exist.

## Next action

Commit the key rotation and verification results, then proceed to the next planned stage.
