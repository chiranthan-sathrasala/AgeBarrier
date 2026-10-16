# QR decoder spike

## Environment

- Node: 22.14.0
- OS: Windows
- Images tested: 25 manifest QR images plus `official_sample_dense.png` (26 total)
- The harness is [`scripts/qr-spike.mjs`](../scripts/qr-spike.mjs), run with `npm run spike:qr`.
- Payloads are read from the fixture files at runtime. This report does not reproduce decoded digits or document fields.

## Candidate facts

Package sizes are installed directory sizes measured in this checkout, not minified bundle sizes. The likely browser payload is smaller for the pure-JS packages after bundling and tree-shaking; the WASM sizes below identify the binary that must also be packaged.

| Candidate | Version tested | npm latest release | License | Installed size | Expected bundled material | Dense/large issue review |
|---|---:|---|---|---:|---|---|
| jsQR | 1.4.0 | 2021-04-24 | Apache-2.0 | 279,741 bytes | pure JS package | Its README warns that not all images decode and the spike found 3 exact failures. No issue claim was treated as a guarantee. |
| @zxing/library | 0.23.0 | 2026-04-29 | Apache-2.0 | 11,863,492 bytes | pure JS package; maintenance-mode project | README says maintenance mode only. The spike found 13 exact failures, so it is not suitable for this input. |
| zxing-wasm | 3.1.5 | 2026-10-06 | MIT | 3,705,169 bytes | reader JS plus local `zxing_reader.wasm` (966,895 bytes) | ZXing-C++ reader; no qualifying dense failure was found in the tested set. Exact and degraded results below are the evidence used. |
| Browser `BarcodeDetector` | platform API | Chrome documentation: barcode detection launched in Chrome 83 for Android | browser-provided | 0 package bytes | no package | Supports QR through the browser API, but is not tested. Extension-page availability for this project still needs a manual Chrome test. |

Sources checked: [jsQR repository](https://github.com/cozmo/jsQR), [@zxing/library repository](https://github.com/zxing-js/library), [zxing-wasm repository](https://github.com/Sec-ant/zxing-wasm), [zxing-wasm releases](https://github.com/Sec-ant/zxing-wasm/releases), [Chrome Shape Detection documentation](https://developer.chrome.com/docs/capabilities/shape-detection), and [Chrome MV3 CSP documentation](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).

## Exact-match results

`PASS` means the decoded text exactly matched the corresponding expected fixture after trimming only surrounding whitespace. `FAIL` means no decode or a mismatch. `not tested` means BarcodeDetector was not run in Node and is excluded from totals.

| Image | jsQR | @zxing/library | zxing-wasm | BarcodeDetector |
|---|---|---|---|---|
| adult_25.png | PASS | FAIL | PASS | not tested |
| adult_60.png | PASS | PASS | PASS | not tested |
| bad_dob_format.png | PASS | PASS | PASS | not tested |
| bad_indicator.png | PASS | PASS | PASS | not tested |
| both_hashes.png | FAIL | FAIL | PASS | not tested |
| dec31_minor.png | PASS | PASS | PASS | not tested |
| empty_optional.png | PASS | FAIL | PASS | not tested |
| exactly_18_today.png | PASS | PASS | PASS | not tested |
| future_dob.png | PASS | FAIL | PASS | not tested |
| garbage_digits.png | PASS | FAIL | PASS | not tested |
| jan1_boundary.png | PASS | PASS | PASS | not tested |
| latin1_name.png | PASS | FAIL | PASS | not tested |
| leap_day_2008.png | PASS | FAIL | PASS | not tested |
| leap_day_adult.png | PASS | PASS | PASS | not tested |
| long_address.png | FAIL | FAIL | PASS | not tested |
| minor_10.png | PASS | PASS | PASS | not tested |
| minor_17.png | PASS | FAIL | PASS | not tested |
| mobile_only.png | PASS | FAIL | PASS | not tested |
| not_gzip.png | FAIL | PASS | PASS | not tested |
| tampered_dob.png | PASS | PASS | PASS | not tested |
| tampered_name.png | PASS | FAIL | PASS | not tested |
| tampered_photo.png | PASS | FAIL | PASS | not tested |
| truncated_sig.png | PASS | PASS | PASS | not tested |
| turns_18_tomorrow.png | PASS | PASS | PASS | not tested |
| wrong_key.png | PASS | FAIL | PASS | not tested |
| official_sample_dense.png | PASS | PASS | PASS | not tested |

| Candidate | Exact matches |
|---|---:|
| jsQR | 23/26 |
| @zxing/library | 13/26 |
| zxing-wasm | 26/26 |
| BarcodeDetector | not tested |

## Informational degraded variants

These are generated in memory and do not affect the decision.

| Variant | jsQR | @zxing/library | zxing-wasm |
|---|---:|---:|---:|
| 50% downscale | 23/26 | 18/26 | 26/26 |
| 75% downscale | 21/26 | 12/26 | 26/26 |
| Gaussian blur | 23/26 | 13/26 | 26/26 |
| JPEG quality 75 | 23/26 | 13/26 | 26/26 |

## WASM, CSP, and offline loading

Chrome's MV3 default `extension_pages` policy disables WebAssembly. The minimum policy that permits it is:

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```

No `unsafe-eval`, CDN source, or other remote script source may be added. Chrome's MV3 guidance requires all JavaScript and WASM to be packaged in the extension. `zxing-wasm` documents `prepareZXingModule` overrides for a locally packaged `.wasm`; Stage 3 should copy the version-matched `dist/reader/zxing_reader.wasm` into the extension bundle and provide a local `locateFile`, `wasmBinary`, or `instantiateWasm` override. The spike itself proves local operation in Node by importing the package and passing local PNG bytes; it does not make a browser-extension claim. The package's browser default uses a jsDelivr URL for the WASM, so Stage 3 must override that behavior.

The `@zxing/library` adapter is correctly wired: RGBA PNG pixels are converted to a one-byte-per-pixel luminance `Uint8ClampedArray`, which is the input format expected by `RGBLuminanceSource`, and `HybridBinarizer` is used before decoding. Its full-size result remains 13/26; the 50% result is 18/26. This is not a harness correction: the old and new counts are both 13/26 full-size and 18/26 at 50%.

The script initializes `zxing-wasm` from the local `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` through `prepareZXingModule({ wasmBinary })`. With `globalThis.fetch` replaced by a throwing function during all 26 decodes, the local check passed **26/26**. The package-exported WASM SHA-256 is `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`.

## Decision

**zxing-wasm qualifies for this spike's decision rule:** it decoded all 26 images exactly, and its reader binary can be packaged locally. It is recommended over the pure-JS alternatives despite requiring the `wasm-unsafe-eval` MV3 relaxation because neither pure-JS candidate decoded all 26.

`BarcodeDetector` remains a possible platform-specific fallback, but it is not tested and is not selected. It is excluded from the totals.

This requires owner approval as a TODO(question): AGENTS.md bans eval, while Chrome's documented WASM exception requires `wasm-unsafe-eval`.

## How to bundle locally (Stage 3)

Do not integrate this in Stage 2. In Stage 3, package the exact `zxing_reader.wasm` matching the npm version, configure `prepareZXingModule` with a URL or binary sourced from the extension's own packaged resource, and add `wasm-unsafe-eval` only to `content_security_policy.extension_pages`. Add a manual Chrome test before relying on extension-page support.

## TODO(question)

- Manually test `BarcodeDetector` and locally packaged `zxing-wasm` in the target Chrome extension page.
