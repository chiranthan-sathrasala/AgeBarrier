# AgeBarrier — Privacy-Preserving Age Verification Chrome Extension (Tier 1) Design Doc

**Status:** Design complete, ready for initial build.
**Doc revision:** 2 (ZKP removed, open items resolved, test strategy added)

## 1. Problem Statement
Websites and parents need a way to confirm a user is 18+ before allowing access to restricted content, without handing identity data to every platform. Turnstile proved this UX pattern works for bot detection (a single frictionless yes/no check); AgeBarrier applies the same idea to age, with cryptographic backing instead of behavioral signals.

## 2. Scope Decision
- **Hobby project**, built with real rigor, not a toy demo.
- **Form factor: Chrome extension**, not a mobile app or website-embedded widget.
- **No server / backend.** Everything runs on-device. This was Tier 2 (site-embedded widget + verifier backend) in earlier drafts — deliberately dropped for now.
- Rationale for dropping Tier 2: no control over third-party websites to force adoption of a widget; a server-side verification-on-behalf-of-others model also sits in a legal grey area under Aadhaar offline verification rules (OVSE "cannot verify on behalf of another entity").
- The extension is understood to be installed by a parent/guardian on a shared or child-accessible device — this shapes the threat model (see §6).

## 3. Core Trust Chain
1. **UIDAI** is the root of trust (out of scope to question — same assumption any Aadhaar-based system makes).
2. **Aadhaar Secure QR code** carries UIDAI-signed demographic data (name, DOB, address, photo) and works fully offline — no API Setu / DigiLocker registration needed.
3. **Local signature verification** (RSA-2048, SHA256withRSA) confirms the QR data is authentic and untampered, using a cached copy of UIDAI's public key.
4. **Local age check:** after the signature passes, the extension reads the DOB and evaluates age ≥ 18 with a plain date comparison.
5. **Local face match** binds the physical person at the screen to the document, addressing the "borrowed ID" gap that a document-only check cannot close.

> **Design correction (rev 2):** earlier drafts included a local Zero-Knowledge Proof of "signature valid AND age ≥ 18". It was removed. A ZKP only has value when proving something to an external party without revealing the underlying data. With no website, no server and no Tier 2, the only party checking the age predicate is the extension itself, so there is no one to hide the DOB from. A proof generated and verified by the same party adds complexity and no privacy benefit. The signature check remains and is the real security gate. Mitigation for DOB exposure: the extension never persists the DOB or any other QR field (see §4.1 step 7 and §6).

## 4. End-to-End Flow

### 4.1 First-Time Verification (per profile)
1. Extension detects a page on its gated-site list and blocks content before it loads (full-screen block page, not an overlay — enforced via `declarativeNetRequest`/redirect so it can't be bypassed by deleting an element).
2. Block screen: single action, "Scan Aadhaar QR." No manual continue option anywhere in the flow.
3. QR scanned/uploaded → decoded → parsed → UIDAI signature checked against cached public key (see §5a for the exact QR format and check order).
   - Invalid signature or malformed payload → block screen: "Could not verify this document." End. The parser fails closed: unknown or malformed structure is rejected, never guessed at.
4. DOB and photo extracted from QR (in extension's own isolated context, not an injectable content script). The photo is a raw JPEG2000 codestream and is decoded in-browser (see §7).
5. Camera opens → liveness check (blink/head-turn) → face match against QR photo.
   - Fails → block screen: "Face didn't match the ID. Access denied." End. (This moment is also when a present parent/guardian would notice an attempt — see §6.)
6. Age predicate evaluated: DOB vs. today (plain comparison; DOB must be strictly DD-MM-YYYY, a valid date, and not in the future).
   - Under 18 → block screen: "You must be 18 or older." End.
7. On success, two items are stored, each signed with a non-extractable local key (see §7):
   - A signed "age verified" credential containing only: profile id, verified flag, issued-at, and expiry (issued-at + 30 days). **The DOB and all other QR fields are discarded and never stored.**
   - The face embedding (a derived vector, not the raw photo) from step 5.
8. Content unlocks automatically.

### 4.2 Return Visits
1. Page blocked as usual.
2. User picks their profile ("who's watching" style selector — not 1:N matching against all stored profiles, to avoid higher false-accept risk).
3. Camera opens → liveness + face match against **that profile's** stored embedding only.
   - Fails → block screen, same denial message. End.
   - Succeeds → stored age credential confirms 18+ and is unexpired → content unlocks.
4. **Face scan is required on every access attempt** — no persistent bypass after first verification.
5. **QR re-scan is not required on every visit**, but the stored age credential **expires after 30 days**, after which a fresh QR scan is required. This follows standard session-token hygiene: limits blast radius if a credential is ever compromised, and forces periodic refresh of the cached UIDAI key.

### 4.3 Multi-Profile Support
- Storage holds an array of profile records (label + signed embedding + signed age credential), not a single one.
- "Add new user" re-runs the full first-time flow (§4.1) and appends a new profile without affecting existing ones.
- Netflix-style explicit profile selection avoids the higher false-match risk of comparing one live face against all stored profiles at once.

## 5. UIDAI Public Key Management
- Cached locally after first fetch; not re-fetched on every scan.
- Background re-check periodically (daily/weekly) to catch rotation.
- Falls back to last-known-good cached key if the fetch fails (fail-open on availability, fail-closed on validity).
- Fetched only over HTTPS from UIDAI's domain, hardcoded in the extension (no dynamic domain resolution).
- Note: this is the one deliberate exception to "fully offline" — a small, non-personal background request, not user data leaving the device.
- **Test mode:** development builds verify against a self-generated test public key instead of UIDAI's. This is a **build-time configuration flag, not a runtime toggle**, so a release build cannot accidentally ship with the test key active. Test keys and test data must never be included in release builds.

## 5a. Secure QR Format (verified against UIDAI spec)
Source: UIDAI "Secure QR Code Specification" (March 2019), cross-checked by decoding the official sample payload printed in that document. Parser and test data follow this layout:

1. Scanned QR text is a decimal number → big integer → bytes → **gzip-decompress**.
2. **16 text fields, each terminated by byte `0xFF`** (including the last, VTC), encoded **ISO-8859-1** (not UTF-8): indicator, reference id, name, DOB, gender, care of, district, landmark, house, location, pincode, post office, state, street, sub-district, VTC. There is **no version field**; the first field is the mobile/email indicator (0–3).
3. **Photo:** raw JPEG2000 codestream (starts `FF 4F FF 51`, 60×60 in the official sample, about 880 bytes) — not a `.jp2` file with a container header. Begins immediately after the VTC delimiter.
4. **Hashes:** 32-byte email and/or mobile hash depending on the indicator (0: none, 1 or 2: one, 3: two), after the photo.
5. **Signature:** last 256 bytes. Signed data is everything before the signature (hash bytes included). Algorithm: SHA256withRSA.
6. Reference id = last 4 Aadhaar digits + `YYYYMMDDHHMMSSsss` timestamp (the spec's prose says DDMMYYYY; its own sample proves YYYYMMDD). DOB shape is DD-MM-YYYY.

**Check order (extension must follow):** decode/decompress → verify signature over the signed region → strict structural parse (16 fields, valid indicator, photo markers `FF4F…FFD9` after stripping 32 × hash-count bytes) → strict DOB validation → age check. Never trust parsed fields before the signature passes.

**Unverified items (carry as open items, §9):** a spec contradiction on whether indicator 1 means email-only or mobile-only (irrelevant to age verification, which only needs the hash count); behaviour of QR codes issued after 2019; and ISO-8859-1 handling beyond ASCII (the official sample is ASCII only).

## 6. Threat Model Summary

| Attacker | Defended? | Notes |
|---|---|---|
| Minor with no adult document | Yes | Cannot produce a QR that passes UIDAI signature verification |
| Minor borrowing an adult's QR alone | Yes | Face match catches document ≠ person |
| Minor resembling the adult closely (e.g. sibling) | No | Known, stated limitation of face matching generally |
| Minor physically present with adult's help at verification moment | Accepted, not defended | Reframed as acceptable: the face-scan request is itself the moment a present guardian would intervene. Whether the guardian notices/logs are cleared afterward is explicitly out of scope — the goal is blocking the moment of attempt, not guaranteed after-the-fact detection |
| Technical user editing stored credential/embedding directly | Mitigated | Both signed with a **non-extractable** Web Crypto key — cannot be read out even via DevTools, only used internally to sign/verify. Raises the bar from "trivial edit" to "must defeat browser key isolation" |
| Technical user editing the extension's own code | Not defended by the extension | Inherent limit of any purely client-side enforcement. Real mitigation is the deployment model: a parent-managed/supervised Chrome profile (Family Link or Chrome Enterprise policy) that force-installs the extension, blocks its removal and disables Developer Mode. This is a **documented deployment requirement**, not a feature of the extension. Without it, a technical user on an unrestricted browser can still edit anything |
| Forger with a fake/edited QR | Yes | UIDAI signature check fails; any single byte change breaks the signature |
| Malformed or adversarial QR payload (bad gzip, bad structure, bad DOB, future DOB) | Yes | Strict parser fails closed; covered by negative test cases (§10) |
| Stale/rotated UIDAI public key | Partial | Fails closed; background refresh (§5) mitigates |
| Network/data exposure of PII | Yes | No document data or raw photo ever transmitted; only an occasional public-key fetch leaves the device |
| DOB/QR fields visible to the extension itself | Mitigated | With ZKP removed, the extension briefly reads the DOB in its own isolated context. It is never persisted or logged; only the signed age credential and face embedding are stored |
| Extension logging/caching bugs | Depends | Needs manual verification during dev that console/storage hold only signed derived credentials, never raw QR fields |
| UIDAI issuance compromise | Out of scope | Same root-of-trust assumption as any Aadhaar-based system |

## 7. Key Design Decisions (Why, Not Just What)
- **No ZKP:** see the design correction in §3. Simpler, removes the hardest and least-mature component, and loses no real privacy because no external verifier exists.
- **Face match is a plain local gate:** biometric comparison cannot practically be proven inside a SNARK (open research area); it was never a candidate for the circuit.
- **Two face libraries, two jobs:**
  - **Liveness (blink/head-turn):** MediaPipe Face Landmarker (Google, actively maintained; landmarks plus head pose; runs client-side via WASM).
  - **Identity matching:** `@vladmandic/face-api`, the maintained fork of the unmaintained original face-api.js (ResNet-based 128-value descriptor compared by distance). Its maintainer's newer library "Human" is the longer-term successor and worth evaluating.
  - Both must be confirmed to run fully offline with no external calls (see §9).
- **JPEG2000 decoding:** no browser decodes JPEG2000 natively. Candidate: the pure-JavaScript `jpeg2000` package (built on the PDF.js codec, no WASM). WASM options (e.g. OpenJPH, itk-wasm) are overkill for a 60×60 image. Maintenance status of the candidate is unconfirmed — check before committing. The decoder must accept a **raw codestream** (not only a `.jp2` container).
- **Non-extractable local signing key (Web Crypto API):** stored credentials/embeddings are signed with a key that JS code itself can never read out, only use via the crypto API. This is a real browser security guarantee, not obfuscation — the correct implementation choice over a naively stored signing key.
- **Store a face embedding, not the photo:** lower-footprint and avoids retaining the actual government photograph, but is still biometric data under DPDP Act terms — stated explicitly in data-handling docs rather than claiming "zero PII stored."
- **Credential expiry fixed at 30 days.**
- **No backend, no DigiLocker:** avoids API Setu registration requirements and the "verifying on behalf of others" compliance grey area; keeps the whole system self-contained on one device.

## 8. Known, Accepted Limitations (state these explicitly — don't try to engineer around them)
- Cannot fully stop a minor resembling the verified adult (e.g. sibling) from passing face match.
- Cannot stop a technical user from modifying the extension's own code to skip checks entirely — true of any client-side-only enforcement. Mitigated only by the managed-profile deployment requirement (§6).
- Relies on UIDAI as an unquestioned root of trust.
- Only protects the specific gated sites configured in the extension's list — no general "detect any age gate" heuristic.
- Depends on the guardian noticing or checking logs; a minor clearing logs afterward is accepted as out of scope.
- A technical adult on an unmanaged, unrestricted browser can defeat the extension entirely.

## 9. Open Items
**Resolved in rev 2:** credential expiry (30 days); ZKP tooling question (ZKP dropped); JPEG2000 encoding (confirmed, raw codestream); face-library selection (§7); test-data strategy (§10).

**Still open before or during build:**
- **Real UIDAI certificate:** obtain UIDAI's actual public certificate and test the pipeline with one genuine Secure QR (your own, handled carefully). The signature has so far only been verified against a test key.
- **Post-2019 QR layout:** no source found for a layout change since March 2019; an unconfirmed recollection of a later "V2" prefix exists. Keep the parser strict and reject unknown first fields.
- **Indicator 1 vs 2 contradiction** in the UIDAI spec (email-only vs mobile-only). Not needed for age verification.
- **MV3 compatibility:** confirm each library (MediaPipe, face-api fork, JPEG2000 decoder) loads and runs in Manifest V3. WASM under MV3's content security policy needs explicit testing. Camera access (`getUserMedia`) cannot run in a service worker, so the camera and ML work belong in an extension page (e.g. the block page), not the background script.
- **JPEG2000 library maintenance:** check the candidate's issue tracker and confirm it decodes a raw codestream.
- **QR scanning library:** real Secure QR codes are dense (the official sample is about 3,100 digits). Test the chosen in-browser QR decoder on dense codes; in testing, OpenCV's default decoder failed on some while a ZXing-based decoder read all of them.
- **Face-match threshold and liveness tuning:** pick a distance threshold and test on real, consented face data.
- **Camera UX:** upload vs. live capture as the entry point for the first QR scan.
- **Offline verification:** confirm that MediaPipe and face-api model files are bundled in the extension and nothing is fetched at runtime.

## 10. Test Strategy
**Test dataset (generated, fictional, signed with a self-generated test key — never UIDAI's, never real Aadhaar data):**
- 25 cases with a known expected result each, defined in `manifest.json`: passes (including age boundaries: exactly 18 today, 18 tomorrow, leap-day birthdays, Jan 1 and Dec 31), under-18, forged (DOB/name/photo edited after signing, wrong signing key), and malformed (not gzip, bad indicator, random digits, bad DOB format, future DOB, truncated signature).
- Cases cover indicators 0–3 (hash handling), ISO-8859-1 names, long and empty address fields.
- UIDAI's own official sample payload is included as **parser ground truth** (it cannot be signature-verified without UIDAI's real key; against the test key it must be rejected as a bad signature while parsing correctly).
- A reference verifier (`verify.py`) encodes the expected check order and confirms all cases.
- Tests use a **fixed clock (2026-10-02)** so age boundaries never drift.

**Known gaps in test data:** the embedded photos are cartoon placeholders and exercise JPEG2000 decoding only. Face matching and liveness need separate real face data from consenting volunteers or an openly licensed dataset; never use anyone's real Aadhaar photo. Test keys and fixtures must never ship in a release build.

**Verification checks during development:** console and storage hold only signed derived credentials, never raw QR fields; no network requests other than the UIDAI key fetch.