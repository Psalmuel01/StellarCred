// Issuer signing abstraction.
//
// Production issuers should never load a raw secp256k1 private key into the
// Node.js process.  This module provides a pluggable IssuerSigner interface
// with two built-in implementations:
//
//   - EnvSigner  — signs with a local private key (dev/mock only)
//   - KmsSigner  — delegates to AWS KMS (secp256k1, ECDSA_SHA_256)
//
// Selected via the ISSUER_SIGNER env var ("env" | "kms", default "env").
//
// SECURITY
// --------
// - ISSUER_PRIVATE_KEY must NEVER carry a NEXT_PUBLIC_ prefix.
// - KmsSigner holds only a key ID — the raw key never leaves the KMS.
// - prehash: false is preserved: KMS Sign is called with MessageType = DIGEST,
//   which tells KMS the caller already hashed the message.  The 32-byte
//   commitment digest is signed directly without re-hashing.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { IssuerSigner } from "@stellarcred/issuer";
import { env } from "./env";

// ---------------------------------------------------------------------------
// DER → raw (r ‖ s) 64-byte conversion
// ---------------------------------------------------------------------------
// AWS KMS returns ECDSA signatures in DER-encoded ASN.1 form:
//
//   SEQUENCE {
//     INTEGER r
//     INTEGER s
//   }
//
// Noir's std::ecdsa_secp256k1 verifier expects the compact 64-byte form:
//   r (32 bytes, big-endian) ‖ s (32 bytes, big-endian)
//
// DER integers may omit leading zeros; this function right-aligns each
// component into a fixed 32-byte buffer.
export function derToRawSig(der: Uint8Array): number[] {
  let offset = 0;

  if (der[offset++] !== 0x30) {
    throw new Error("Invalid DER signature: expected SEQUENCE (0x30)");
  }
  // Total length of the SEQUENCE body (ignored — we read components
  // individually).
  const _totalLen = der[offset++];

  // ── r ──────────────────────────────────────────────────────────────────
  if (der[offset++] !== 0x02) {
    throw new Error("Invalid DER signature: expected INTEGER (0x02) for r");
  }
  const rLen = der[offset++];
  const r = der.slice(offset, offset + rLen);
  offset += rLen;

  // ── s ──────────────────────────────────────────────────────────────────
  if (der[offset++] !== 0x02) {
    throw new Error("Invalid DER signature: expected INTEGER (0x02) for s");
  }
  const sLen = der[offset++];
  const s = der.slice(offset, offset + sLen);

  if (rLen > 32 || sLen > 32) {
    throw new Error(
      `Invalid DER signature: component length exceeds 32 bytes (r=${rLen}, s=${sLen})`,
    );
  }

  // Right-align into 32-byte buffers (big-endian, leading zeros implicit).
  const raw = new Uint8Array(64);
  raw.set(r, 32 - rLen);
  raw.set(s, 64 - sLen);

  return Array.from(raw);
}

// ---------------------------------------------------------------------------
// EnvSigner — dev / mock mode
// ---------------------------------------------------------------------------
// Signs with a secp256k1 private key loaded from the ISSUER_PRIVATE_KEY env
// var.  The key exists as plaintext in the process — acceptable for local
// development and CI, NEVER for production.
export class EnvSigner implements IssuerSigner {
  private readonly key: Uint8Array;
  private pubCache?: { x: number[]; y: number[] };

  constructor(privateKeyHex: string) {
    this.key = Uint8Array.from(Buffer.from(privateKeyHex, "hex"));
  }

  async sign(digest: Uint8Array): Promise<number[]> {
    // prehash: false — sign the raw 32-byte digest directly.
    const sig = secp256k1.sign(digest, this.key, { prehash: false });
    return Array.from(sig);
  }

  async publicKey(): Promise<{ x: number[]; y: number[] }> {
    if (!this.pubCache) {
      const p = secp256k1.getPublicKey(this.key, false); // 0x04 || x || y
      this.pubCache = {
        x: Array.from(p.slice(1, 33)),
        y: Array.from(p.slice(33, 65)),
      };
    }
    return this.pubCache;
  }
}

// ---------------------------------------------------------------------------
// KmsSigner — production / HSM mode
// ---------------------------------------------------------------------------
// Delegates signing to AWS KMS.  The raw private key never leaves the KMS;
// this class holds only a key ID and the region configuration.
//
// KMS call: Sign(KeyId, Message=<32-byte digest>, MessageType=DIGEST,
//                     SigningAlgorithm=ECDSA_SHA_256)
//
// MessageType=DIGEST tells KMS the caller already applied the hash — KMS
// uses the digest directly as the ECDSA hash input without re-hashing.
// This preserves the prehash: false semantics Noir requires.
//
// KMS returns a DER-encoded signature; we convert to raw (r ‖ s) via
// derToRawSig().
export class KmsSigner implements IssuerSigner {
  private readonly keyId: string;
  private readonly region: string | undefined;
  private pubCache?: { x: number[]; y: number[] };

  constructor(keyId: string, region?: string) {
    this.keyId = keyId;
    this.region = region;
  }

  async sign(digest: Uint8Array): Promise<number[]> {
    // Lazy-import so @aws-sdk/client-kms is only pulled in when KMS mode is
    // actually selected.  This avoids adding ~3 MB to the dev bundle.
    const { KMSClient, SignCommand } = await import("@aws-sdk/client-kms");

    const client = new KMSClient(
      this.region ? { region: this.region } : {},
    );
    const cmd = new SignCommand({
      KeyId: this.keyId,
      Message: digest,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    });

    const res = await client.send(cmd);
    if (!res.Signature) {
      throw new Error("KMS Sign returned no signature");
    }

    return derToRawSig(new Uint8Array(res.Signature));
  }

  async publicKey(): Promise<{ x: number[]; y: number[] }> {
    if (this.pubCache) return this.pubCache;

    const { KMSClient, GetPublicKeyCommand } = await import("@aws-sdk/client-kms");

    const client = new KMSClient(
      this.region ? { region: this.region } : {},
    );
    const cmd = new GetPublicKeyCommand({ KeyId: this.keyId });
    const res = await client.send(cmd);

    if (!res.PublicKey) {
      throw new Error("KMS GetPublicKey returned no key");
    }

    // The DER-encoded SubjectPublicKeyInfo contains the uncompressed
    // point (0x04 ‖ x ‖ y) inside a BIT STRING.  Scan for the 0x04 tag
    // that starts the uncompressed EC point — it's unique in the encoding
    // because the preceding bytes are ASN.1 headers and OIDs.
    const der = new Uint8Array(res.PublicKey);
    const tagIdx = der.indexOf(0x04);
    if (tagIdx === -1 || der.length < tagIdx + 65) {
      throw new Error("KMS GetPublicKey: could not locate uncompressed EC point in DER");
    }

    this.pubCache = {
      x: Array.from(der.slice(tagIdx + 1, tagIdx + 33)),
      y: Array.from(der.slice(tagIdx + 33, tagIdx + 65)),
    };
    return this.pubCache;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the appropriate IssuerSigner based on the ISSUER_SIGNER env var.
 *
 *   ISSUER_SIGNER=env  (default) → EnvSigner using ISSUER_PRIVATE_KEY
 *   ISSUER_SIGNER=kms            → KmsSigner  using KMS_KEY_ID
 *
 * When ISSUER_SIGNER=env and ISSUER_PRIVATE_KEY is unset, falls back to
 * the deterministic demo key (same as the original route handler behaviour).
 */
export function getSigner(): IssuerSigner {
  const mode = env.ISSUER_SIGNER ?? "env";

  if (mode === "kms") {
    const keyId = env.KMS_KEY_ID;
    if (!keyId) {
      throw new Error(
        "KMS_KEY_ID must be set when ISSUER_SIGNER=kms",
      );
    }
    return new KmsSigner(keyId, env.KMS_REGION);
  }

  // env (default) — local dev / mock
  return new EnvSigner(
    env.ISSUER_PRIVATE_KEY ||
      Buffer.from(
        sha256(new TextEncoder().encode("stellarcred-demo-issuer")),
      ).toString("hex"),
  );
}
