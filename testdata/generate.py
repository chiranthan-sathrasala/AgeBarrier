#!/usr/bin/env python3
"""
Test-fixture generator for the age-verification extension.

Produces Secure-QR-*style* payloads signed with a TEST RSA key (never UIDAI's).
All identities are fictional and clearly labelled. Output:

  keys/test_private.pem, keys/test_public.pem, keys/other_private.pem, keys/other_public.pem
  qr/<case>.png          scannable QR images
  payload/<case>.txt     the decimal string a QR scanner returns
  photo/<case>.j2k       the embedded raw JPEG2000 codestream (placeholder cartoon, see README)
  manifest.json          expected result for every case (the test oracle)

Layout verified against UIDAI "Secure QR Code Specification" (March 2019) AND by decoding the sample
payload printed in that PDF (see official_sample/):
  16 text fields joined/terminated by 0xFF (ISO-8859-1), first field = indicator 0-3, no version field
  -> raw JPEG2000 codestream (FF4F...FFD9), 60x60, NO delimiter after VTC other than the one ending it
  -> 32-byte hash(es) per indicator -> 256-byte RSA-2048 SHA256withRSA signature over everything before it
  -> gzip -> big-endian bytes as one big integer -> decimal string -> numeric QR
"""
import gzip, hashlib, json, os, random, io, sys
from datetime import date
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from PIL import Image, ImageDraw
import numpy as np
import cv2

OUT = os.path.dirname(os.path.abspath(__file__))
for d in ("keys", "qr", "payload", "photo"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

# Fixed "today" so expected results never drift. Extension tests must inject this clock.
TODAY = date(2026, 10, 2)
DELIM = b"\xff"

# ---------------------------------------------------------------- keys
def make_key(name, seed_note):
    path = os.path.join(OUT, "keys", f"{name}_private.pem")
    if os.path.exists(path):
        return serialization.load_pem_private_key(open(path, "rb").read(), None)
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    open(path, "wb").write(k.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    open(os.path.join(OUT, "keys", f"{name}_public.pem"), "wb").write(k.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    return k

TEST_KEY = make_key("test", "trusted by the extension in test mode")
OTHER_KEY = make_key("other", "NOT trusted - simulates a forger's key")

# ---------------------------------------------------------------- photo (placeholder)
def placeholder_photo(label, seed, size=(60, 60)):
    """Synthetic avatar as a RAW JPEG2000 codestream (FF4F FF51...), like the real QR. NOT a usable face."""
    rnd = random.Random(seed)
    bg = tuple(rnd.randint(150, 230) for _ in range(3))
    im = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(im)
    skin = tuple(rnd.randint(120, 220) for _ in range(3))
    w, h = size
    d.ellipse([w*.2, h*.12, w*.8, h*.72], fill=skin)
    d.ellipse([w*.34, h*.34, w*.42, h*.42], fill=(20, 20, 20))
    d.ellipse([w*.58, h*.34, w*.66, h*.42], fill=(20, 20, 20))
    d.arc([w*.35, h*.5, w*.65, h*.65], 20, 160, fill=(90, 30, 30), width=1)
    buf = io.BytesIO()
    im.save(buf, format="JPEG2000", no_jp2=True, quality_mode="rates", quality_layers=[28], irreversible=True)
    out = buf.getvalue()
    assert out[:4] == b"\xff\x4f\xff\x51", "must be a raw codestream, not a JP2 container"
    return out

# ---------------------------------------------------------------- payload builder
def fake_hash(tag, ref):
    return hashlib.sha256(f"fake-{tag}-{ref}".encode()).digest()   # 32 bytes; not a real contact hash

def uidai_hash(value, refid):
    """Offline-XML hashing: SHA256 applied N times, N = 4th char of refid (last Aadhaar digit); 0/1 -> once."""
    n = max(1, int(refid[3]))
    h = value.encode()
    for _ in range(n):
        h = hashlib.sha256(h).digest()
    return h

def hash_blocks(indicator, refid):
    """photo | email hash | mobile hash | signature. 1=email only, 2=mobile only, 3=both (data-fields prose)."""
    email = uidai_hash("test.person@example.invalid", refid)
    mobile = uidai_hash("9999900000", refid)
    return {0: b"", 1: email, 2: mobile, 3: email + mobile}.get(indicator, b"")

def build_signed_payload(p, key, photo):
    """p: dict of demographic fields. Returns (signed_body, signature)."""
    ind = p.get("email_mobile", 2)
    fields = [
        str(ind), p["ref_id"], p["name"], p["dob"], p["gender"], p["care_of"], p["district"],
        p["landmark"], p["house"], p["location"], p["pincode"],
        p["post_office"], p["state"], p["street"], p["sub_district"], p["vtc"],
    ]
    text = b"".join(f.encode("iso-8859-1") + DELIM for f in fields)   # every field, incl. VTC, ends with 0xFF
    body = text + photo + hash_blocks(ind, p["ref_id"])
    sig = key.sign(body, padding.PKCS1v15(), hashes.SHA256())
    assert len(sig) == 256
    return body, sig

def to_decimal(raw):
    return str(int.from_bytes(gzip.compress(raw, 9, mtime=0), "big"))

def from_decimal(s):
    n = int(s)
    return gzip.decompress(n.to_bytes((n.bit_length() + 7) // 8, "big"))

# ---------------------------------------------------------------- QR render
_WECHAT = cv2.wechat_qrcode_WeChatQRCode()

def _encode(digits, version):
    prm = cv2.QRCodeEncoder_Params()
    prm.mode = cv2.QRCodeEncoder_MODE_NUMERIC
    prm.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_L
    prm.version = version
    m = cv2.QRCodeEncoder_create(prm).encode(digits)
    m = cv2.copyMakeBorder(m, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
    scale = max(3, 900 // m.shape[0])
    return cv2.resize(m, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)

def render_qr(digits, path):
    """OpenCV's QR encoder emits undecodable codes at some versions, so self-check every image with an
    independent (ZXing-based) decoder and step up the QR version until it round-trips."""
    img = _encode(digits, 0)
    tried = ["auto"]
    version = None
    for attempt in range(0, 15):
        res, _ = _WECHAT.detectAndDecode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img)
        if res and res[0] == digits:
            cv2.imwrite(path, img)
            return
        # derive current version from the module grid, then go one higher
        if version is None:
            probe = cv2.QRCodeEncoder_create(cv2.QRCodeEncoder_Params()).encode(digits)
            version = (probe.shape[0] - 17) // 4
        version += 1
        if version > 40: break
        tried.append(version)
        img = _encode(digits, version)
    raise RuntimeError(f"no QR version round-trips for payload of {len(digits)} digits (tried {tried})")

# ---------------------------------------------------------------- cases
def age_on(dob_str, today=TODAY):
    d, m, y = map(int, dob_str.split("-"))
    return today.year - y - ((today.month, today.day) < (m, d))

def person(n, name, dob, gender="M", **kw):
    base = dict(
        ref_id=f"{1000+n:04d}20260901120000000",
        name=name, dob=dob, gender=gender, care_of="S/O: TEST GUARDIAN",
        district="Test District", landmark="Near Test Landmark", house="1",
        location="Test Location", pincode="560001", post_office="Test PO",
        state="Karnataka", street="Test Street", sub_district="Test Taluk", vtc="Test VTC",
    )
    base.update(kw)
    return base

# (case_id, person, signing_key_label, mutation, expected, note)
CASES = [
    # --- happy path / age boundaries (today = 2026-10-02)
    ("adult_25",          person(1, "TEST ADULT TWENTYFIVE", "14-03-2001", "F"), "test", None, "pass", "clear adult"),
    ("adult_60",          person(2, "TEST SENIOR SIXTY",     "05-11-1966"),        "test", None, "pass", "older adult"),
    ("exactly_18_today",  person(3, "TEST EIGHTEEN TODAY",   "02-10-2008"),        "test", None, "pass", "turns 18 today: boundary, must PASS"),
    ("turns_18_tomorrow", person(4, "TEST ALMOST EIGHTEEN",  "03-10-2008"),        "test", None, "under_18", "17y364d: boundary, must FAIL"),
    ("minor_17",          person(5, "TEST MINOR SEVENTEEN",  "20-06-2009", "F"),   "test", None, "under_18", "clear minor"),
    ("minor_10",          person(6, "TEST MINOR TEN",        "15-01-2016"),        "test", None, "under_18", "young child"),
    ("leap_day_adult",    person(7, "TEST LEAPDAY ADULT",    "29-02-2004"),        "test", None, "pass", "leap-day DOB, age 22"),
    ("leap_day_2008",    person(8, "TEST LEAPDAY EIGHTEEN", "29-02-2008"),     "test", None, "pass", "leap-day DOB, age 18 on 2026-10-02 (clock-injected tests near Feb should add more leap cases)"),
    ("jan1_boundary",     person(9, "TEST NEWYEAR EIGHTEEN", "01-01-2008"),        "test", None, "pass", "year-start boundary"),
    ("dec31_minor",       person(10, "TEST YEAREND MINOR",   "31-12-2008"),        "test", None, "under_18", "year-end boundary"),
    # --- parsing robustness
    ("latin1_name",      person(11, "TEST JOSÉ MÜLLER-ÑANDU", "10-10-1990", "M"),   "test", None, "pass", "non-ASCII Latin-1 chars; spec says ISO-8859-1, NOT UTF-8"),
    ("long_address",      person(12, "TEST LONG ADDRESS", "01-06-1985", house="Flat 402, Block C, Test Residency Apartments",
                                 street="Very Long Test Street Name Number Twelve Cross", landmark="Opposite the Test Bus Terminal"),
                          "test", None, "pass", "long fields"),
    ("empty_optional",    person(13, "TEST EMPTY FIELDS", "01-06-1985", care_of="", landmark="", house="", street=""),
                          "test", None, "pass", "empty delimiters must not shift field indices"),
    ("both_hashes",       person(14, "TEST CONTACT BOTH", "01-06-1985", email_mobile=3), "test", None, "pass", "indicator=3: email(32)+mobile(32) hash bytes sit between photo and signature"),
    ("mobile_only",       person(25, "TEST CONTACT MOBILE", "01-06-1985", email_mobile=2), "test", None, "pass", "indicator=2: one 32-byte hash; same shape as UIDAI's official sample"),
    # --- attack / failure cases
    ("tampered_dob",      person(15, "TEST TAMPERED DOB", "02-10-2008"),           "test", "flip_dob", "bad_signature", "minor edits DOB 17->adult after signing"),
    ("tampered_name",     person(16, "TEST TAMPERED NAME", "01-01-1990"),          "test", "flip_name", "bad_signature", "any byte change must break sig"),
    ("tampered_photo",    person(17, "TEST TAMPERED PHOTO", "01-01-1990"),         "test", "flip_photo", "bad_signature", "photo swap after signing"),
    ("wrong_key",         person(18, "TEST FORGER", "01-01-1990"),                 "other", None, "bad_signature", "valid structure, signed by untrusted key"),
    ("truncated_sig",     person(19, "TEST TRUNC SIG", "01-01-1990"),              "test", "trunc_sig", "malformed", "signature cut short"),
    ("not_gzip",          person(20, "TEST NOT GZIP", "01-01-1990"),               "test", "no_gzip", "malformed", "decimal decodes but isn't gzip"),
    ("bad_indicator",    person(21, "TEST BAD INDICATOR", "01-01-1990", email_mobile=7), "test", None, "malformed", "indicator 7 not in 0-3 (signed correctly, so only the parser may reject)"),
    ("garbage_digits",    person(22, "TEST GARBAGE", "01-01-1990"),                "test", "garbage", "malformed", "random digit string, not a Secure QR"),
    ("bad_dob_format",    person(23, "TEST BAD DOB", "1990/01/01"),                "test", None, "malformed", "validly signed but DOB not DD-MM-YYYY; extension must fail closed, not guess"),
    ("future_dob",        person(24, "TEST FUTURE DOB", "01-01-2030"),             "test", None, "malformed", "validly signed, DOB in the future; must not be treated as adult"),
]

def apply_mutation(m, body, sig, photo_len):
    if m == "flip_dob":
        i = body.index(b"02-10-2008"); body = body[:i] + b"02-10-1990" + body[i+10:]
    elif m == "flip_name":
        i = body.index(b"TAMPERED NAME"); body = body[:i] + b"TAMPERED NAMX" + body[i+13:]
    elif m == "flip_photo":
        b = bytearray(body); i = body.index(b"\xff\x4f\xff\x51") + 40; b[i] ^= 0xFF; body = bytes(b)   # inside the photo
    elif m == "trunc_sig":
        sig = sig[:200]
    return body, sig

def main():
    manifest = {"today": TODAY.isoformat(), "trusted_public_key": "keys/test_public.pem",
                "spec": "UIDAI Secure QR Code Specification, March 2019 (Version 0) + decode of its official sample",
                "still_unverified": [
                    "signature check against UIDAI's REAL public certificate (needs the real cert; not done here)",
                    "behaviour of QR codes issued after 2019 (no source found for any layout change)",
                    "spec contradicts itself on whether indicator 1 means email-only or mobile-only"],
                "cases": []}
    for cid, p, keylabel, mut, expected, note in CASES:
        key = TEST_KEY if keylabel == "test" else OTHER_KEY
        photo = placeholder_photo(p["name"].split()[-1] if p["name"].isascii() else "TEST", seed=cid)
        open(os.path.join(OUT, "photo", f"{cid}.j2k"), "wb").write(photo)

        if mut == "garbage":
            digits = "".join(random.Random(7).choice("0123456789") for _ in range(3000))
        else:
            body, sig = build_signed_payload(p, key, photo)
            body, sig = apply_mutation(mut, body, sig, len(photo))
            raw = body + sig
            if mut == "no_gzip":
                digits = str(int.from_bytes(raw, "big"))
            else:
                digits = to_decimal(raw)

        open(os.path.join(OUT, "payload", f"{cid}.txt"), "w").write(digits)
        qr_ok = True
        try:
            render_qr(digits, os.path.join(OUT, "qr", f"{cid}.png"))
        except Exception as e:
            qr_ok = False
            print(f"QR render failed for {cid}: {e}", file=sys.stderr)

        manifest["cases"].append({
            "id": cid, "expected": expected, "note": note, "qr": f"qr/{cid}.png" if qr_ok else None,
            "payload": f"payload/{cid}.txt", "digits": len(digits),
            "name": p["name"], "dob": p["dob"],
            "age_on_today": age_on(p["dob"]) if p["dob"][2] == "-" and expected in ("pass", "under_18") else None,
            "photo": f"photo/{cid}.j2k", "signed_by": keylabel, "mutation": mut,
        })
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=2, ensure_ascii=False)
    print(f"generated {len(CASES)} cases")

if __name__ == "__main__":
    main()
