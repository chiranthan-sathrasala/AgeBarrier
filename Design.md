# Privacy-Preserving Age Verification — Chrome Extension (Tier 1) Design Doc

## 1. Problem Statement
Websites and parents need a way to confirm a user is 18+ before allowing access to restricted content, without handing identity data to every platform. Turnstile proved this UX pattern works for bot detection (a single frictionless yes/no check); this project applies the same idea to age, with cryptographic backing instead of behavioral signals.

## 2. Scope Decision
- **Hobby project**, built with real rigor, not a toy demo.
- **Form factor: Chrome extension**, not a mobile app or website-embedded widget.
- **No server / backend.** Everything runs on-device. This was Tier 2 (site-embedded widget + verifier backend) in earlier drafts — deliberately dropped for now.
- Rationale for dropping Tier 2: no control over third-party websites to force adoption of a widget; a server-side verification-on-behalf-of-others model also sits in a legal grey area under Aadhaar offline verification rules (OVSE "cannot verify on behalf of another entity").
- The extension is understood to be installed by a parent/guardian on a shared or child-accessible device — this shapes the threat model (see §6).

## 3. Core Trust Chain
1. **UIDAI** is the root of trust (out of scope to question — same assumption any Aadhaar-based system makes).
2. **Aadhaar Secure QR code** carries UIDAI-signed demographic data (name, DOB, address, photo) and works fully offline — no API Setu / DigiLocker registration needed.
3. **Local signature verification** confirms the QR data is authentic and untampered, using a cached copy of UIDAI's public key.
4. **Local Zero-Knowledge Proof** proves "signature is valid AND age ≥ 18" without exposing DOB or any other QR field.
5. **Local face match** binds the physical person at the screen to the document, addressing the "borrowed ID" gap that a document-only check cannot close.

## 4. End-to-End Flow

### 4.1 First-Time Verification (per profile)
1. Extension detects a page on its gated-site list and blocks content before it loads (full-screen block page, not an overlay — enforced via `declarativeNetRequest`/redirect so it can't be bypassed by deleting an element).
2. Block screen: single action, "Scan Aadhaar QR." No manual continue option anywhere in the flow.
3. QR scanned/uploaded → decoded → UIDAI signature checked against cached public key.
   - Invalid signature → block screen: "Could not verify this document." End.
4. DOB and photo extracted from QR (in extension's own isolated context, not an injectable content script).
5. Camera opens → liveness check (blink/head-turn) → face match against QR photo.
   - Fails → block screen: "Face didn't match the ID. Access denied." End. (This moment is also when a present parent/guardian would notice an attempt — see §6.)
6. Age predicate evaluated: DOB vs. today.
   - Under 18 → block screen: "You must be 18 or older." End.
7. ZK proof generated, covering **only** signature validity + age predicate (face match is a separate local gate, not inside the circuit — folding biometric comparison into a zk-SNARK is an unsolved research problem, out of scope).
8. Proof verified locally. On success, two items are stored, each signed with a non-extractable local key (see §7):
   - A signed "age verified" credential (so DOB never needs re-deriving).
   - The face embedding (a derived vector, not the raw photo) from step 5.
9. Content unlocks automatically.

### 4.2 Return Visits
1. Page blocked as usual.
2. User picks their profile ("who's watching" style selector — not 1:N matching against all stored profiles, to avoid higher false-accept risk).
3. Camera opens → liveness + face match against **that profile's** stored embedding only.
   - Fails → block screen, same denial message. End.
   - Succeeds → stored age credential confirms 18+ → content unlocks.
4. **Face scan is required on every access attempt** — no persistent bypass after first verification.
5. **QR re-scan is not required on every visit**, but the stored age credential should carry an expiry (proposed: 30–90 days window, exact value still open) after which a fresh QR scan is required. This follows standard session-token hygiene: limits blast radius if a credential is ever compromised, and forces periodic refresh of the cached UIDAI key.

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

## 6. Threat Model Summary

| Attacker | Defended? | Notes |
|---|---|---|
| Minor with no adult document | Yes | Can't produce a valid proof |
| Minor borrowing an adult's QR alone | Yes (new) | Face match now catches document ≠ person |
| Minor resembling the adult closely (e.g. sibling) | No | Known, stated limitation of face matching generally |
| Minor physically present with adult's help at verification moment | Accepted, not defended | Reframed as acceptable: the face-scan request is itself the moment a present guardian would intervene. Whether the guardian notices/logs are cleared afterward is explicitly out of scope — the goal is blocking the moment of attempt, not guaranteed after-the-fact detection |
| Technical user editing stored credential/embedding directly | Mitigated | Both signed with a **non-extractable** Web Crypto key — cannot be read out even via DevTools, only used internally to sign/verify. Raises the bar from "trivial edit" to "must defeat browser key isolation" |
| Technical user editing the extension's own code | Not defended | Inherent limit of any purely client-side enforcement; stated as a known limitation, not solved |
| Forger with a fake/edited QR | Yes | UIDAI signature check fails |
| Stale/rotated UIDAI public key | Partial | Fails closed; background refresh (§5) mitigates |
| Network/data exposure of PII | Yes | No document data or raw photo ever transmitted; only an occasional public-key fetch leaves the device |
| Extension logging/caching bugs | Depends | Needs manual verification during dev that console/storage hold only signed derived credentials, never raw QR fields |
| UIDAI issuance compromise | Out of scope | Same root-of-trust assumption as any Aadhaar-based system |

## 7. Key Design Decisions (Why, Not Just What)
- **Face match outside the ZK circuit:** zero-knowledge ML (proving a biometric match inside a SNARK) is an open research area, not hobby-buildable. Face match is a plain local gate instead.
- **Non-extractable local signing key (Web Crypto API):** stored credentials/embeddings are signed with a key that JS code itself can never read out, only use via the crypto API. This is a real browser security guarantee, not obfuscation — the correct implementation choice over a naively stored signing key.
- **Store a face embedding, not the photo:** lower-footprint and avoids retaining the actual government photograph, but is still biometric data under DPDP Act terms — stated explicitly in data-handling docs rather than claiming "zero PII stored."
- **No backend, no DigiLocker:** avoids API Setu registration requirements and the "verifying on behalf of others" compliance grey area; keeps the whole system self-contained on one device.

## 8. Known, Accepted Limitations (state these explicitly — don't try to engineer around them)
- Cannot fully stop a minor resembling the verified adult (e.g. sibling) from passing face match.
- Cannot stop a technical user from modifying the extension's own code to skip checks entirely — true of any client-side-only enforcement.
- Relies on UIDAI as an unquestioned root of trust.
- Only protects the specific gated sites configured in the extension's list — no general "detect any age gate" heuristic.
- Depends on the guardian noticing or checking logs; a minor clearing logs afterward is accepted as out of scope.

## 9. Open Items
- Exact credential expiry window (30–90 days range proposed, not finalized).
- Confirm current status/maintenance of ZKP tooling suitable for in-browser use (e.g. Anon Aadhaar) before committing to a specific library.
- Confirm whether modern Aadhaar Secure QR images are JPEG2000-encoded and what in-browser decoding approach that requires.
- Decide on camera UX details (upload vs. live capture entry point for the first QR scan).
