# Test dataset for the age-verification extension

## What this is
Fake "Aadhaar-style" QR codes for made-up people, signed with a TEST key so you can build and test
without real Aadhaar cards. Every case has a known correct answer (manifest.json).

## Which files do what
| Path | Purpose | Use it to... |
|---|---|---|
| qr/*.png | 25 QR images | upload into the extension's "Scan Aadhaar QR" screen |
| payload/*.txt | the text inside each QR (a ~2000-digit number) | feed straight into unit tests (no camera/image step) |
| photo/*.j2k | the photo inside each QR (cartoon placeholder) | test JPEG2000 decoding alone |
| official_sample/ | the sample payload printed in UIDAI's own spec | ground truth for your PARSER (see below) |
| keys/test_public.pem | pretend-UIDAI public key | the key your extension trusts in test mode |
| keys/test_private.pem, other_*.pem | used only by generate.py | never ship, never trust other_* |
| manifest.json | the answer key | compare your extension's result per case |
| generate.py / verify.py | rebuilds data / reference checker | optional; verify.py is a model of the logic you must write |

Run `python3 verify.py` any time: it must print ALL GOOD.
Use a FIXED CLOCK of 2026-10-02 in tests (age boundaries depend on it).

## Format: what is verified and how
Verified against UIDAI "Secure QR Code Specification" (March 2019) AND by decoding its official sample payload:
1. decimal string -> big integer -> bytes -> gzip-decompress
2. 16 text fields, EACH ended by byte 0xFF (including the last, VTC), ISO-8859-1:
   indicator, refid, name, dob, gender, care_of, district, landmark, house, location, pincode,
   post_office, state, street, sub_district, vtc
3. photo = raw JPEG2000 codestream (starts FF4F FF51, 60x60) - NOT a .jp2 file with a container header
4. then 32-byte email hash and/or mobile hash depending on the indicator (0:none, 1/2: one, 3: two)
5. then 256-byte RSA signature (SHA256withRSA) over EVERYTHING before it, hashes included
6. refid = last 4 Aadhaar digits + YYYYMMDDHHMMSSsss; DOB is DD-MM-YYYY
Note there is NO version field: the first field is the indicator.

## Still NOT verified (be honest about these in your design doc)
1. Real signature check: the sample can't be verified without UIDAI's real public certificate. Fetch it from
   UIDAI and test with a genuine QR before trusting the pipeline.
2. Post-2019 layout: I found no source for any change, but I vaguely recall a "V2" prefix in later versions.
   Unconfirmed. Make your parser strict: reject an unknown first field instead of guessing.
3. The spec contradicts itself on whether indicator 1 means email-only or mobile-only. Age verification only
   needs the hash COUNT, so don't depend on which.
4. The spec's prose says the refid timestamp is DDMMYYYY...; its own sample proves YYYYMMDD. We follow the sample.
5. Only ASCII appears in the official sample. ISO-8859-1 handling beyond ASCII follows the spec text only.
6. Photos here are cartoons: no use for face matching. Real face test data is still needed.
7. QR images were checked with OpenCV's ZXing-based decoder only; try a phone scanner too.
