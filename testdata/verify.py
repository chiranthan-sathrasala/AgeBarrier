#!/usr/bin/env python3
"""
Reference verifier / test oracle, written from the UIDAI Secure QR spec (Mar 2019).
Order of checks mirrors what the extension should do:
  1. decimal -> bigint -> bytes -> gunzip          (else malformed)
  2. signature = last 256 bytes; verify SHA256withRSA over everything before it   (else bad_signature)
  3. strict structural parse: 16 FF-terminated fields, indicator 0-3, photo codestream FF4F..FFD9 after
     stripping 32*hashcount bytes, DOB strictly DD-MM-YYYY and not in the future   (else malformed)
  4. age >= 18 on the fixed clock                  -> pass / under_18
Also: decodes every QR IMAGE (ZXing-based decoder) and every extracted photo (must be 60x60).
"""
import json, gzip, io, os, re
from datetime import date
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.exceptions import InvalidSignature
from PIL import Image
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(f"{HERE}/manifest.json"))
TODAY = date.fromisoformat(m["today"])
PUB = serialization.load_pem_public_key(open(f"{HERE}/{m['trusted_public_key']}", "rb").read())
HASHCOUNT = {"0": 0, "1": 1, "2": 1, "3": 2}   # only the COUNT matters for age verification
FIELDS = "indicator refid name dob gender care_of district landmark house location pincode post_office state street sub_district vtc".split()

class Malformed(Exception): pass

def to_bytes(digits):
    try:
        n = int(digits)
        return gzip.decompress(n.to_bytes((n.bit_length() + 7) // 8, "big"))
    except Exception:
        raise Malformed("not decimal/gzip")

def parse(raw):
    """Strict structural parse. Returns dict incl. photo bytes. Does NOT check the signature."""
    if len(raw) < 256 + 16 + 4: raise Malformed("too short")
    pos, i = [], 0
    for _ in range(16):
        try: i = raw.index(b"\xff", i)
        except ValueError: raise Malformed("fewer than 16 fields")
        pos.append(i); i += 1
    vals, s = {}, 0
    for name, p in zip(FIELDS, pos):
        vals[name] = raw[s:p].decode("iso-8859-1"); s = p + 1
    ind = vals["indicator"]
    if ind not in HASHCOUNT: raise Malformed(f"bad indicator {ind!r}")
    end = len(raw) - 256 - 32 * HASHCOUNT[ind]
    photo = raw[pos[15] + 1:end]
    if not (photo[:4] == b"\xff\x4f\xff\x51" and photo[-2:] == b"\xff\xd9"):
        raise Malformed("photo is not a J2K codestream (check hash-byte count)")
    vals["photo"] = photo
    return vals

def parse_dob(s):
    if not re.fullmatch(r"\d{2}-\d{2}-\d{4}", s): raise Malformed("DOB format")
    d, mo, y = map(int, s.split("-"))
    try: dob = date(y, mo, d)
    except ValueError: raise Malformed("DOB invalid date")
    if dob > TODAY: raise Malformed("DOB in future")
    return dob

def evaluate(digits):
    try:
        raw = to_bytes(digits)
        if len(raw) < 256 + 16: raise Malformed("too short")
        try: PUB.verify(raw[-256:], raw[:-256], padding.PKCS1v15(), hashes.SHA256())
        except InvalidSignature: return "bad_signature", None
        v = parse(raw); dob = parse_dob(v["dob"])
    except Malformed:
        return "malformed", None
    age = TODAY.year - dob.year - ((TODAY.month, TODAY.day) < (dob.month, dob.day))
    return ("pass" if age >= 18 else "under_18"), v

det = cv2.wechat_qrcode_WeChatQRCode()   # ZXing-based; cv2.QRCodeDetector fails on dense codes
bad = 0
for c in m["cases"]:
    digits = open(f"{HERE}/{c['payload']}").read()
    res, _ = det.detectAndDecode(cv2.imread(f"{HERE}/{c['qr']}"))
    img_ok = bool(res) and res[0] == digits
    got, v = evaluate(digits)
    photo_ok = "-"
    if v is not None:
        im = Image.open(io.BytesIO(v["photo"])); im.load()
        photo_ok = "60x60" if im.size == (60, 60) else f"BAD{im.size}"
    # truncated_sig: shifted signature window -> bad_signature or malformed are both correct rejections
    ok = (got == c["expected"] or (c["id"] == "truncated_sig" and got in ("bad_signature", "malformed"))) \
         and img_ok and photo_ok in ("-", "60x60")
    bad += (not ok)
    print(f"{'OK ' if ok else 'BAD'} {c['id']:18} expected={c['expected']:13} got={got:13} qr-image={'ok' if img_ok else 'MISMATCH'} photo={photo_ok}")

# ---- UIDAI's own sample: parse only; signature can't be checked without UIDAI's real certificate
print("\nOfficial UIDAI sample (spec p.6-7):")
raw = to_bytes(open(f"{HERE}/official_sample/payload.txt").read())
v = parse(raw); parse_dob(v["dob"]) if False else None
im = Image.open(io.BytesIO(v["photo"])); im.load()
sig_vs_test_key, _ = evaluate(open(f"{HERE}/official_sample/payload.txt").read())
checks = {
    "structure parses (16 fields, J2K photo, hash count)": True,
    "photo decodes as 60x60": im.size == (60, 60),
    "refid timestamp is YYYYMMDDHHMMSSsss": bool(re.fullmatch(r"\d{4}20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{9}", v["refid"])),
    "DOB shape DD-MM-YYYY": bool(re.fullmatch(r"\d{2}-\d{2}-\d{4}", v["dob"])),
    "rejected by TEST key as bad_signature": sig_vs_test_key == "bad_signature",
}
for k, val in checks.items():
    print(f"{'OK ' if val else 'BAD'} {k}"); bad += (not val)
print("\nALL GOOD" if not bad else f"\n{bad} FAILURES")
