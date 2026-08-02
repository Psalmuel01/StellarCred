#!/usr/bin/env node
/**
 * demo-witness.mjs — Witness generation for the StellarCred demo.
 *
 * Takes a credential JSON file (produced by demo-issue.mjs) and a credential
 * type, runs the Noir circuit to produce a witness, and writes the gzipped
 * witness to the specified output path.
 *
 * Usage:
 *   node scripts/demo-witness.mjs <credentials.json> <kyc|age|funds> <output.gz>
 *
 * Requires:
 *   cd frontend && pnpm install
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.resolve(__dirname, "..", "frontend", "public", "circuits");

// Circuit input builders — mirrors /api/witness/route.ts
function buildInputs(type, cred) {
  const sigInputs = {
    sig: cred.sig,
    issuer_x: cred.issuerPubX,
    issuer_y: cred.issuerPubY,
  };
  switch (type) {
    case "kyc":
      return { secret: cred.value, salt: cred.salt, ...sigInputs, commitment: cred.commitment };
    case "age":
      return {
        date_of_birth: cred.value,
        salt: cred.salt,
        ...sigInputs,
        commitment: cred.commitment,
        current_date: String(Math.floor(Date.now() / 86_400_000)),
        threshold_years: cred.claimParams?.threshold_years ?? "18",
      };
    case "funds":
      return {
        balance: cred.value,
        salt: cred.salt,
        ...sigInputs,
        commitment: cred.commitment,
        threshold: cred.claimParams?.threshold ?? "10000",
      };
    default:
      throw new Error(`Unknown credential type: ${type}`);
  }
}

function circuitPath(type) {
  const name = type === "kyc" ? "kyc" : type === "age" ? "age" : "funds";
  return path.join(CIRCUITS_DIR, `${name}.json`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: node scripts/demo-witness.mjs <credentials.json> <kyc|age|funds> <output.gz>");
    process.exit(1);
  }

  const [credsPath, type, outputPath] = args;

  const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
  const cred = creds.find((c) => c.type === type);
  if (!cred) {
    console.error(`Credential not found for type: ${type}`);
    process.exit(1);
  }

  const circuitJson = JSON.parse(readFileSync(circuitPath(type), "utf-8"));
  const { Noir } = await import("@noir-lang/noir_js");
  const noir = new Noir(circuitJson);
  const inputs = buildInputs(type, cred);
  const { witness } = await noir.execute(inputs);

  const gz = gzipSync(Buffer.from(witness));
  writeFileSync(outputPath, gz);
  console.log(`Witness written: ${outputPath} (${gz.length} bytes)`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
