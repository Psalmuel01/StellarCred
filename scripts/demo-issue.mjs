#!/usr/bin/env node
/**
 * demo-issue.mjs — Mock credential issuance for the StellarCred demo.
 *
 * Replicates the mock-mode logic of /api/issue: derives the demo issuer key from
 * sha256("stellarcred-demo-issuer"), generates random credential preimages,
 * computes Poseidon2 commitments, and signs each with secp256k1.
 *
 * Outputs a JSON array of credentials to stdout, one per requested type.
 *
 * Usage:
 *   node scripts/demo-issue.mjs <holder-address> <kyc|age|funds>...
 *
 * Example:
 *   node scripts/demo-issue.mjs GABC... kyc age funds > /tmp/creds.json
 *
 * Requires:
 *   cd frontend && pnpm install   (for @noble/curves, @noble/hashes, @noir-lang/noir_js)
 */

import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";

// ---------------------------------------------------------------------------
// Demo issuer key — deterministic, never changes.
// Public key (x || y) must match what deploy.sh registers.
// ---------------------------------------------------------------------------
const DEMO_SK = sha256(new TextEncoder().encode("stellarcred-demo-issuer"));
const DEMO_PK = secp256k1.getPublicKey(DEMO_SK, false); // 0x04 || x || y
const ISSUER_X = Array.from(DEMO_PK.slice(1, 33));
const ISSUER_Y = Array.from(DEMO_PK.slice(33, 65));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function be32(v) {
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
}

function randomField() {
  return "0x" + randomBytes(31).toString("hex");
}

function signCommitment(commitment) {
  const sig = secp256k1.sign(be32(BigInt(commitment)), DEMO_SK, { prehash: false });
  return Array.from(sig);
}

function pubkeyHex() {
  const x = Buffer.from(ISSUER_X).toString("hex");
  const y = Buffer.from(ISSUER_Y).toString("hex");
  return x + y;
}

// ---------------------------------------------------------------------------
// Poseidon2 commitment (requires @noir-lang/noir_js + commit circuit JSON)
// ---------------------------------------------------------------------------
async function poseidonCommit(value, salt) {
  // Dynamic import so the script fails with a clear message if deps aren't installed.
  const { Noir } = await import("@noir-lang/noir_js");
  // commit.json is the compiled commit helper circuit (witness-only, never proven).
  const circuitPath = new URL("../../frontend/public/circuits/commit.json", import.meta.url);
  const circuit = JSON.parse(await (await import("fs")).promises.readFile(circuitPath, "utf-8"));
  const noir = new Noir(circuit);
  const { returnValue } = await noir.execute({ value, salt });
  return String(returnValue);
}

// ---------------------------------------------------------------------------
// Attribute → credential value (same logic as /api/issue)
// ---------------------------------------------------------------------------
function attributeToValue(type) {
  switch (type) {
    case "kyc":
      return randomField();
    case "age": {
      // 1990-01-01 in days since epoch → proves age ≥ 34ish by 2026.
      const dob = new Date("1990-01-01");
      return String(Math.floor(dob.getTime() / 86_400_000));
    }
    case "funds": {
      // Mock balance: $50,000 (same default as /api/issue mock mode).
      return "50000";
    }
    default:
      throw new Error(`Unknown credential type: ${type}`);
  }
}

function typeTitle(type) {
  switch (type) {
    case "kyc": return "KYC Complete";
    case "age": return "Age Verified";
    case "funds": return "Proof of Funds";
    default: return type;
  }
}

function buildClaimLabel(type) {
  switch (type) {
    case "kyc": return "identity verified";
    case "age": return "age ≥ 18";
    case "funds": return "balance > $10,000";
    default: return type;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: node scripts/demo-issue.mjs <holder-address> <issuer-address> <type> [type...]");
    console.error("  types: kyc, age, funds");
    process.exit(1);
  }

  const holder = args[0];
  const issuerId = args[1];
  const types = args.slice(2);
  const validTypes = ["kyc", "age", "funds"];
  for (const t of types) {
    if (!validTypes.includes(t)) {
      console.error(`Invalid type: ${t}. Valid: ${validTypes.join(", ")}`);
      process.exit(1);
    }
  }

  const creds = [];
  for (const type of types) {
    const value = attributeToValue(type);
    const salt = randomField();
    const commitment = await poseidonCommit(value, salt);
    const sig = signCommitment(commitment);
    const expiry = String(Math.floor(Date.now() / 1000) + 365 * 86_400); // 1 year

    const cred = {
      type,
      title: typeTitle(type),
      claim: buildClaimLabel(type),
      issuer: "StellarCred Demo Authority",
      issuerId,
      holder,
      value,
      salt,
      commitment,
      sig,
      issuerPubX: ISSUER_X,
      issuerPubY: ISSUER_Y,
      issuedAt: Math.floor(Date.now() / 1000),
      expiry,
    };

    // Add claim params for threshold types
    if (type === "age") cred.claimParams = { threshold_years: "18" };
    if (type === "funds") cred.claimParams = { threshold: "10000" };

    creds.push(cred);
  }

  console.log(JSON.stringify(creds, null, 2));
  console.error(`\nIssuer public key (hex): ${pubkeyHex()}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
