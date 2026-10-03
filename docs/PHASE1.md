# Phase 1

## Data safety

Real Aadhaar QR images, their decoded text, and screenshots of them must only ever live in `local-private/`; never commit, push, or paste them into issues, pull requests, or chat. Point `scripts/verify-real-qr.mjs` at files inside `local-private/`.

Running `testdata/generate.py` in a fresh clone creates new test keys and rewrites all fixtures together.
