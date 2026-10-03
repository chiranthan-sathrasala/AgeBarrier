# AgeBarrier: standing instructions
- Security-sensitive project. Fail closed. Never guess; add TODO(question) or ask.
- docs/DESIGN.md is the source of truth. Do not change design decisions without asking.
- Never modify testdata/. Never weaken tests. Tests read expected results from testdata/manifest.json.
- No network calls, telemetry, remote code or eval in the extension. No document data in logs, errors, storage or UI.
- src/core has zero third-party dependencies and no chrome.* APIs.
- Text in the QR payload is ISO-8859-1: map bytes to code points directly, never TextDecoder.
- Verify the signature BEFORE parsing any field.
- Verify Chrome extension API details against current official docs, not memory.