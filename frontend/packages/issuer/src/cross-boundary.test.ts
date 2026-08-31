/**
 * Cross-boundary regression test: issuer ↔ circuit contract.
 *
 * Guards the contract between the issuer's TypeScript signing pipeline and the
 * Noir circuits. If either side changes its byte-encoding (be32), prehash
 * behaviour, or Poseidon2 layout, this test breaks — which is the intended
 * regression guard.
 *
 * Two layers of tests:
 *   - Explicit: replicates the issuer signing logic (~be32 + prehash:false) and
 *     feeds directly into the kyc_proof circuit via Noir.js WASM.
 *   - End-to-end: calls the production `IssuerClient.issue()` and feeds its
 *     output into the circuit, exercising the full pipeline.
 *
 * NOTE: This test verifies the circuit in Noir.js WASM, not via bb/nargo.
 * The ACVM blackbox functions (verify_signature, Poseidon2) are the same
 * across backends, but a WASM-native divergence would not be caught here.
 * For native verification, run `nargo execute` against the generated
 * Prover.toml.
 *
 * Depends on:
 *   - commit-circuit.json  (synced by prebuild)
 *   - public/circuits/kyc.json  (checked in)
 */
import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { IssuerClient } from "./index";

// ---------------------------------------------------------------------------
// Replicated issuer signing logic (must match packages/issuer/src/index.ts
// byte-for-byte, otherwise this guard is testing the wrong thing).
// ---------------------------------------------------------------------------

/** Fixed test key — 32 bytes of 0x01, equivalent to "01".repeat(32) in hex. */
const TEST_PRIVATE_KEY = new Uint8Array(32).fill(0x01);

function be32(v: bigint): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
}

/**
 * Compute a secp256k1 signature over `commitment` (a decimal-string Field)
 * using the EXACT same be32 + prehash:false pipeline as `signCommitment` in
 * packages/issuer/src/index.ts.
 */
function signLikeIssuer(
  commitment: string,
  sk: Uint8Array,
): {
  sig: Uint8Array;
  pubX: number[];
  pubY: number[];
} {
  const digest = be32(BigInt(commitment));
  const sig = secp256k1.sign(digest, sk, { prehash: false });
  const pub = secp256k1.getPublicKey(sk, false); // 0x04 || x || y
  return {
    sig,
    pubX: Array.from(pub.slice(1, 33)),
    pubY: Array.from(pub.slice(33, 65)),
  };
}

// ---------------------------------------------------------------------------
// Shared circuit loading helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NoirInstance = any;

async function loadCommitCircuit(): Promise<NoirInstance> {
  const { Noir } = await import("@noir-lang/noir_js");
  const circuit = (await import("./commit-circuit.json")).default;
  return new Noir(circuit as any);
}

async function loadKycCircuit(): Promise<NoirInstance> {
  const { Noir } = await import("@noir-lang/noir_js");
  const circuit = (await import("../../../public/circuits/kyc.json")).default;
  return new Noir(circuit as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-boundary: issuer signature → circuit", () => {
  // ── Explicit pipeline tests ────────────────────────────────────────────

  it("a commitment signed by the issuer pipeline verifies inside kyc_proof", async () => {
    // 1. Compute commitment (matches issuer's poseidonCommit).
    const commitNoir = await loadCommitCircuit();
    const { returnValue } = await commitNoir.execute({ value: "42", salt: "7" });
    const commitment = String(returnValue);

    // 2. Sign with the issuer's exact be32 + prehash:false logic.
    const { sig, pubX, pubY } = signLikeIssuer(commitment, TEST_PRIVATE_KEY);

    // Sanity check: standalone secp256k1 verify passes.
    const pubkeyUncompressed = new Uint8Array([0x04, ...pubX, ...pubY]);
    expect(
      secp256k1.verify(sig, be32(BigInt(commitment)), pubkeyUncompressed, {
        prehash: false,
      }),
    ).toBe(true);

    // 3. Verify inside the kyc_proof circuit.
    //
    // The circuit asserts:
    //   assert(Poseidon2::hash([secret, salt], 2) == commitment);
    //   assert(verify_signature(issuer_x, issuer_y, sig, commitment_bytes));
    // If either fails, noir.execute() throws.
    const kycNoir = await loadKycCircuit();
    await expect(
      kycNoir.execute({
        secret: "42",
        salt: "7",
        sig: Array.from(sig),
        commitment,
        issuer_x: pubX,
        issuer_y: pubY,
      }),
    ).resolves.toBeDefined();

    // 4. Tampered commitment must fail.
    //    The valid path above already proved the circuit loads and executes
    //    correctly, so a rejection here can only be an assertion failure.
    const tampered = (BigInt(commitment) + 1n).toString();
    await expect(
      kycNoir.execute({
        secret: "42",
        salt: "7",
        sig: Array.from(sig),
        commitment: tampered,
        issuer_x: pubX,
        issuer_y: pubY,
      }),
    ).rejects.toThrow();
  });

  it("a different value/salt pair (hex fields) works end-to-end", async () => {
    const commitNoir = await loadCommitCircuit();
    const kycNoir = await loadKycCircuit();

    // Non-trivial values — catches accidental hard-coding.
    const value = "0x" + "ab".repeat(31); // 62 hex chars, fits BN254 Field
    const salt = "0x7f" + "00".repeat(30);

    const { returnValue } = await commitNoir.execute({ value, salt });
    const commitment = String(returnValue);
    const { sig, pubX, pubY } = signLikeIssuer(commitment, TEST_PRIVATE_KEY);

    // Valid execution must succeed.
    await expect(
      kycNoir.execute({
        secret: value,
        salt,
        sig: Array.from(sig),
        commitment,
        issuer_x: pubX,
        issuer_y: pubY,
      }),
    ).resolves.toBeDefined();

    // Tampered commitment must fail.
    const tampered = (BigInt(commitment) + 1n).toString();
    await expect(
      kycNoir.execute({
        secret: value,
        salt,
        sig: Array.from(sig),
        commitment: tampered,
        issuer_x: pubX,
        issuer_y: pubY,
      }),
    ).rejects.toThrow();
  });

  it("fails when the issuer_x public key is tampered", async () => {
    const commitNoir = await loadCommitCircuit();
    const kycNoir = await loadKycCircuit();

    const { returnValue } = await commitNoir.execute({
      value: "42",
      salt: "7",
    });
    const commitment = String(returnValue);
    const { sig, pubX, pubY } = signLikeIssuer(commitment, TEST_PRIVATE_KEY);

    // Flip the first byte of issuer_x — signature must now fail to verify.
    const tamperedPubX = [...pubX];
    tamperedPubX[0] ^= 0xff;

    await expect(
      kycNoir.execute({
        secret: "42",
        salt: "7",
        sig: Array.from(sig),
        commitment,
        issuer_x: tamperedPubX,
        issuer_y: pubY,
      }),
    ).rejects.toThrow();
  });

  // ── End-to-end: production IssuerClient pipeline ────────────────────────

  it("a credential issued by IssuerClient verifies inside kyc_proof", async () => {
    const issuer = new IssuerClient({
      privateKey: "01".repeat(32), // same key as TEST_PRIVATE_KEY
    });

    const credential = await issuer.issue({
      type: "kyc",
      holder: "GABCDEXAMPLEHOLDERADDRESS",
      issuerId: "test-issuer",
      issuerName: "Test Issuer",
      expiry: "90 days",
      attribute: {},
    });

    // Feed the IssuerClient's exact output into the circuit.
    const kycNoir = await loadKycCircuit();
    await expect(
      kycNoir.execute({
        secret: credential.value,
        salt: credential.salt,
        sig: credential.sig,
        commitment: credential.commitment,
        issuer_x: credential.issuerPubX,
        issuer_y: credential.issuerPubY,
      }),
    ).resolves.toBeDefined();

    // Tamper the commitment — must fail.
    const tampered = (BigInt(credential.commitment) + 1n).toString();
    await expect(
      kycNoir.execute({
        secret: credential.value,
        salt: credential.salt,
        sig: credential.sig,
        commitment: tampered,
        issuer_x: credential.issuerPubX,
        issuer_y: credential.issuerPubY,
      }),
    ).rejects.toThrow();
  });
});
