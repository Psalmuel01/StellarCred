// Client-side zero-knowledge proof generation.
//
// Witness generation (Noir circuit execution) runs server-side via POST /api/witness —
// this avoids bundling @noir-lang/acvm_js WASM through Next.js/webpack, which fails in
// dev mode for packages inside pnpm's nested .pnpm/ layout. The witness bytes are
// returned as a hex string and decoded here.
//
// Proving (UltraHonk) still runs entirely in the browser via /public/bb/ (loaded with
// webpackIgnore so webpack never touches it). Private inputs are sent to our own server
// for witness generation only; the proof itself is computed locally.
//
// Toolchain must match the contracts: Noir 1.0.0-beta.9 / bb 0.87.0.

import type { CredentialType } from "./stellar";

/** The compiled-circuit JSON shipped to /public/circuits/{type}.json. */
export interface CircuitArtifact {
  bytecode: string;
}

export interface GeneratedProof {
  /** Raw proof bytes (456 fields × 32 = 14592 bytes), as the contract expects. */
  proof: Uint8Array;
  /** Public inputs serialized as concatenated 32-byte big-endian field elements. */
  publicInputs: Uint8Array;
}

// bb.js returns public inputs as an array of 0x-prefixed field hex strings. The
// contract expects them concatenated as 32-byte big-endian values.
function fieldsToBytes(fields: string[]): Uint8Array {
  const out = new Uint8Array(fields.length * 32);
  fields.forEach((f, i) => {
    const hex = f.replace(/^0x/, "").padStart(64, "0");
    for (let j = 0; j < 32; j++) {
      out[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    }
  });
  return out;
}

// bb.js's UltraHonkBackend always spawns a Web Worker from its prebuilt
// main.worker.js (`new Worker(new URL("./main.worker.js", import.meta.url))`).
// If Next.js/webpack bundles bb.js, it re-wraps that already-bundled worker and
// corrupts it ("Object.defineProperty called on non-object"). So instead we load
// bb.js as a *native* ES module from /public/bb (copied there by
// scripts/copy-bb.mjs on predev/prebuild). `webpackIgnore` keeps webpack from
// touching the import; the browser then resolves main.worker.js / barretenberg.js
// relative to /bb/index.js, untouched.
type BbModule = {
  UltraHonkBackend: new (
    bytecode: string,
    options?: { threads?: number },
  ) => {
    generateProof: (
      witness: Uint8Array,
      options?: { keccak?: boolean },
    ) => Promise<{ proof: Uint8Array; publicInputs: string[] }>;
    destroy: () => Promise<void>;
  };
};

async function loadBb(): Promise<BbModule> {
  // @ts-expect-error - resolved at runtime by the browser from /public/bb, not a build-time module.
  return import(/* webpackIgnore: true */ "/bb/index.js") as Promise<BbModule>;
}

// Stage 1 — server computes the witness (Noir circuit execution).
// Exported so ProofFlow can report progress between stages.
export async function computeWitness(
  type: CredentialType,
  credential: Record<string, unknown>,
): Promise<Uint8Array> {
  const res = await fetch("/api/witness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, credential }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Witness generation failed: ${msg}`);
  }
  const { witness: hex } = (await res.json()) as { witness: string };
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Stage 2 — browser runs UltraHonk over the witness.
// Exported so ProofFlow can call it after stage 1 completes.
export async function proveWithBackend(
  type: CredentialType,
  witness: Uint8Array,
): Promise<GeneratedProof> {
  const circuitRes = await fetch(`/circuits/${type}.json`);
  if (!circuitRes.ok) {
    throw new Error(
      `Compiled circuit "${type}" not found. Run the circuit build to emit /public/circuits/${type}.json.`,
    );
  }
  const circuit = (await circuitRes.json()) as { bytecode: string };

  const { UltraHonkBackend } = await loadBb();
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
  try {
    const { proof, publicInputs } = await backend.generateProof(witness, {
      keccak: true,
    });
    return { proof, publicInputs: fieldsToBytes(publicInputs) };
  } finally {
    await backend.destroy();
  }
}

// Convenience wrapper — runs both stages in sequence.
export async function generateProof(
  type: CredentialType,
  credential: Record<string, unknown>,
): Promise<GeneratedProof> {
  const witness = await computeWitness(type, credential);
  return proveWithBackend(type, witness);
}
