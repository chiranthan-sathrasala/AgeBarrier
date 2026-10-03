Payload printed in UIDAI's 'Secure QR Code Specification' (March 2019), p.6-7. Public sample from the spec.
Use it as GROUND TRUTH FOR PARSING ONLY. Facts established by decoding it (see verify.py):
 - gzip -> 16 text fields each ended by 0xFF -> raw JPEG2000 codestream (60x60, 883 bytes) -> 32-byte hash -> 256-byte signature
 - first field is the indicator ('2'); there is NO version field
 - refid = 4 digits + YYYYMMDDHHMMSSsss timestamp (the spec's prose says DDMMYYYY; the sample proves YYYYMMDD)
 - DOB shape DD-MM-YYYY
Its signature CANNOT be checked here: that needs UIDAI's real public certificate, which we do not have.
Against the TEST key it must therefore be rejected as bad_signature, while parsing successfully.
