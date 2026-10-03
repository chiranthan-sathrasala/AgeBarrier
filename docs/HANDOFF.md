# AgeBarrier Handoff

## Stage status

- Stage 0 scaffold: done
- Stage 1 core verification: done
- Ignore and attributes configuration: done
- Stage 1 hardening: done

## Validation

- `npm test`: passed, 1 test file and 33 tests
- `npm run lint`: passed
- `npm run typecheck`: passed
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

## Decisions

- Ignored the actual Vite output root `dist/`, plus the requested build/cache directories.
- Ignored test private keys, while leaving already tracked private-key fixtures untouched because the task explicitly forbids untracking tracked files under `testdata/`.
- Kept `package-lock.json`, public test fixtures, public keys, documentation, and project rules addable.
- The Stage 1 hardening changes are ready for the requested commit; no push is planned.
- Kept parser helpers exported only through the deep test path and marked them `internal, for tests only`; the package entry point exposes only the requested API.
- Imported SPKI keys as non-extractable verify-only keys and rejected trusted keys whose algorithm metadata is not RSA-2048/SHA-256.
- Used concurrent decompression reading/writing with cancellation and writer abort on failure.

## Open TODO(question)

- Confirm the future location and behavior of `scripts/verify-real-qr.mjs`.
- Confirm whether the runtime environment should provide `atob` independently of browser APIs.

## Known failures or unfinished work

- `docs/PHASE1.md` references `scripts/verify-real-qr.mjs`, which does not exist yet and is outside this step's scope.
- No known failures remain for the Stage 1 hardening scope.

## Next action

Proceed to the next planned stage after reviewing the Stage 1 hardening commit.
