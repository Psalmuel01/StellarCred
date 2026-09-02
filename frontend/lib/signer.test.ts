// @vitest-environment node
import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { derToRawSig, EnvSigner } from "./signer";

// noble-curves v2 returns a raw 64-byte Uint8Array from secp256k1.sign().
// There is no built-in toDER(), so we build DER manually for the round-trip test.
function rawSigToDER(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error("expected 64-byte compact signature");
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);

  // Strip leading zeros from r and s.
  let rOff = 0;
  while (rOff < 31 && r[rOff] === 0) rOff++;
  let sOff = 0;
  while (sOff < 31 && s[sOff] === 0) sOff++;
  const rBody = r.slice(rOff);
  const sBody = s.slice(sOff);
  // Prepend 0x00 if high bit is set (ASN.1 INTEGER rule).
  const rAdd = (rBody[0] & 0x80) !== 0 ? 1 : 0;
  const sAdd = (sBody[0] & 0x80) !== 0 ? 1 : 0;
  const rLen = rBody.length + rAdd;
  const sLen = sBody.length + sAdd;
  const totalLen = 2 + rLen + 2 + sLen; // INTEGER r + INTEGER s
  const der = new Uint8Array(2 + totalLen);
  der[0] = 0x30; // SEQUENCE
  der[1] = totalLen;
  der[2] = 0x02; // INTEGER
  der[3] = rLen;
  if (rAdd) der[4] = 0x00;
  der.set(rBody, 4 + rAdd);
  der[4 + rLen] = 0x02; // INTEGER
  der[5 + rLen] = sLen;
  if (sAdd) der[6 + rLen] = 0x00;
  der.set(sBody, 6 + rLen + sAdd);
  return der;
}

// ---------------------------------------------------------------------------
// DER → raw (r ‖ s) conversion
// ---------------------------------------------------------------------------

describe("derToRawSig", () => {
  it("converts a known DER signature to raw 64-byte form", () => {
    // Construct a minimal valid DER signature manually.
    // r = 0x01 (1 byte), s = 0x02 (1 byte)
    // SEQUENCE [total=6] { INTEGER [len=1] 0x01, INTEGER [len=1] 0x02 }
    const der = Uint8Array.from([
      0x30, 0x06, // SEQUENCE, length 6
      0x02, 0x01, 0x01, // INTEGER r = 0x01
      0x02, 0x01, 0x02, // INTEGER s = 0x02
    ]);
    const raw = derToRawSig(der);
    expect(raw).toHaveLength(64);

    // r should be right-aligned: 31 zero bytes followed by 0x01
    for (let i = 0; i < 31; i++) expect(raw[i]).toBe(0);
    expect(raw[31]).toBe(1);

    // s should be right-aligned: 31 zero bytes followed by 0x02
    for (let i = 32; i < 63; i++) expect(raw[i]).toBe(0);
    expect(raw[63]).toBe(2);
  });

  it("round-trips through DER encoding and back", () => {
    // Generate a real signature, encode to DER ourselves, decode back, compare.
    const privKey = new Uint8Array(32);
    privKey[31] = 0x42; // not all-zeros to avoid edge cases
    const msg = new Uint8Array(32).fill(0xab);
    const compact = secp256k1.sign(msg, privKey, { prehash: false });
    expect(compact).toHaveLength(64);

    const der = rawSigToDER(compact);
    const raw = derToRawSig(der);

    expect(raw).toEqual(Array.from(compact));
  });

  it("rejects a non-SEQUENCE prefix", () => {
    const der = Uint8Array.from([0x02, 0x02, 0x01, 0x02]);
    expect(() => derToRawSig(der)).toThrow(/expected SEQUENCE/);
  });

  it("rejects a non-INTEGER tag for r", () => {
    const der = Uint8Array.from([
      0x30, 0x04, // SEQUENCE, length 4
      0x03, 0x01, 0x01, // wrong tag 0x03 instead of 0x02
    ]);
    expect(() => derToRawSig(der)).toThrow(/expected INTEGER.*for r/);
  });

  it("rejects a non-INTEGER tag for s", () => {
    const der = Uint8Array.from([
      0x30, 0x06, // SEQUENCE, length 6
      0x02, 0x01, 0x01, // r
      0x03, 0x01, 0x02, // wrong tag 0x03 instead of 0x02
    ]);
    expect(() => derToRawSig(der)).toThrow(/expected INTEGER.*for s/);
  });

  it("rejects components exceeding 32 bytes", () => {
    // r = 33 bytes (too long)
    const rBytes = new Uint8Array(33).fill(0xff);
    const der = Uint8Array.from([
      0x30, 0x23 + 2, // SEQUENCE, length = 2 + 33 + 2 + 1
      0x02, 0x21, // INTEGER, length 33
      ...rBytes,
      0x02, 0x01, 0x01, // INTEGER s = 0x01
    ]);
    expect(() => derToRawSig(der)).toThrow(/exceeds 32 bytes/);
  });

  it("handles 32-byte components with leading zeros stripped", () => {
    // r = 31 bytes (leading zero omitted), s = 30 bytes (leading zeros omitted)
    const r = new Uint8Array(31).fill(0xff);
    const s = new Uint8Array(30).fill(0xfe);
    const der = Uint8Array.from([
      0x30, 0x30 + 0x2 + 0x30 + 0x2 - 2, // SEQUENCE
      0x02, 31, // INTEGER r, length 31
      ...r,
      0x02, 30, // INTEGER s, length 30
      ...s,
    ]);
    const raw = derToRawSig(der);
    expect(raw).toHaveLength(64);

    // r right-aligned: first byte is 0, rest are 0xff
    expect(raw[0]).toBe(0);
    for (let i = 1; i < 32; i++) expect(raw[i]).toBe(0xff);

    // s right-aligned: first two bytes are 0, rest are 0xfe
    expect(raw[32]).toBe(0);
    expect(raw[33]).toBe(0);
    for (let i = 34; i < 64; i++) expect(raw[i]).toBe(0xfe);
  });
});

// ---------------------------------------------------------------------------
// EnvSigner
// ---------------------------------------------------------------------------

// Fixed test key — deterministic, not a real issuer key.
const TEST_PRIVKEY_HEX = "01".repeat(32);

function be32(v: bigint): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
}

describe("EnvSigner", () => {
  it("signs a digest that verifies with secp256k1.verify (prehash: false)", async () => {
    const signer = new EnvSigner(TEST_PRIVKEY_HEX);
    // Use a realistic 32-byte digest (a Poseidon2 commitment-like value).
    const digest = be32(42n);
    const sig = await signer.sign(digest);

    expect(sig).toHaveLength(64);

    // Verify against the public key.
    const { x, y } = await signer.publicKey();
    const pubUncompressed = Uint8Array.from([0x04, ...x, ...y]);
    const ok = secp256k1.verify(Uint8Array.from(sig), digest, pubUncompressed, {
      prehash: false,
    });
    expect(ok).toBe(true);
  });

  it("returns the same public key as secp256k1.getPublicKey", async () => {
    const signer = new EnvSigner(TEST_PRIVKEY_HEX);
    const { x, y } = await signer.publicKey();

    const privBytes = Uint8Array.from(Buffer.from(TEST_PRIVKEY_HEX, "hex"));
    const expected = secp256k1.getPublicKey(privBytes, false); // 0x04 || x || y

    expect(x).toEqual(Array.from(expected.slice(1, 33)));
    expect(y).toEqual(Array.from(expected.slice(33, 65)));
  });

  it("caches the public key across multiple calls", async () => {
    const signer = new EnvSigner(TEST_PRIVKEY_HEX);
    const pk1 = await signer.publicKey();
    const pk2 = await signer.publicKey();
    expect(pk1).toBe(pk2); // same object reference
  });
});
