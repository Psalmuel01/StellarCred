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

type Backend = InstanceType<BbModule["UltraHonkBackend"]>;

// Constructed (or in-flight) UltraHonkBackend instances, keyed by circuit
// type, for this browser tab's session. Construction is the expensive part
// (bytecode fetch + wasm init), so once a backend exists for a type we keep
// it around and reuse it across every subsequent proof of that type instead
// of tearing it down after each use. Callers that own this cache's lifecycle
// (see lib/use-warm-prover.ts) are responsible for calling destroyBackend /
// destroyAllBackends when it's time to let the wasm memory go (e.g. the
// holder page unmounting or the tab closing) -- this module never does so on
// its own.
const backendCache = new Map<CredentialType, Promise<Backend>>();

// Multithreading is only safe once the page is crossOriginIsolated (COOP/COEP
// headers — see next.config.mjs). Read the live value at construction time
// rather than caching it, so a proxy/CDN stripping those headers still falls
// back correctly to the single-threaded path. Omitting `threads` when
// isolated lets bb.js pick its own worker-pool size (it reads
// navigator.hardwareConcurrency internally); logged once so the choice is
// visible in the field.
let loggedIsolation = false;

function backendOptions(): { threads?: number } {
  const isolated = typeof window !== "undefined" && window.crossOriginIsolated;
  if (!loggedIsolation) {
    loggedIsolation = true;
    console.info(`[proof] crossOriginIsolated=${!!isolated}`);
  }
  if (isolated) {
    return {};
  }
  return { threads: 1 };
}

async function buildBackend(type: CredentialType): Promise<Backend> {
  const circuitRes = await fetch(`/circuits/${type}.json`);
  if (!circuitRes.ok) {
    throw new Error(
      `Compiled circuit "${type}" not found. Run the circuit build to emit /public/circuits/${type}.json.`,
    );
  }
  const circuit = (await circuitRes.json()) as { bytecode: string };
  const { UltraHonkBackend } = await loadBb();
  return new UltraHonkBackend(circuit.bytecode, backendOptions());
}

// Returns the cached (or in-flight) backend for `type`, constructing one if
// none exists yet. Concurrent callers for the same type -- e.g. the warm
// trigger firing twice under React StrictMode, or a real prove click racing
// an in-flight warm -- share this exact promise instead of racing separate
// constructions, since the cache is checked and populated synchronously
// (no `await` between the `get` and the `set`).
function getBackend(type: CredentialType): Promise<Backend> {
  let pending = backendCache.get(type);
  if (!pending) {
    pending = buildBackend(type);
    backendCache.set(type, pending);
    // A failed construction must not permanently poison the cache for this
    // type -- evict it so the next call (a warm retry, or the user's actual
    // prove click) gets a fresh attempt instead of replaying the same error
    // forever.
    pending.catch(() => {
      if (backendCache.get(type) === pending) backendCache.delete(type);
    });
  }
  return pending;
}

// Warms the prover for `type` in the background: kicks off backend
// construction (bytecode fetch + wasm init) without blocking the caller or
// throwing. Meant to be called ahead of time (see use-warm-prover.ts) so the
// eventual prove click hits an already-warm cache. If warming fails (network
// error, wasm init failure, etc.) it's logged and swallowed -- the real
// prove click still falls back to constructing fresh via proveWithBackend.
export function warmBackend(type: CredentialType): void {
  const before = backendCache.get(type);
  const pending = getBackend(type);
  if (pending !== before) {
    pending.catch((err) => {
      console.warn(`[proof] Failed to warm prover for "${type}":`, err);
    });
  }
}

// Destroys and evicts the cached backend for `type`, if one exists. Safe to
// call even when nothing was ever warmed/proved for that type.
export async function destroyBackend(type: CredentialType): Promise<void> {
  const pending = backendCache.get(type);
  if (!pending) return;
  backendCache.delete(type);
  try {
    const backend = await pending;
    await backend.destroy();
  } catch {
    // Construction itself failed, or destroy() threw -- either way there's
    // nothing left to clean up.
  }
}

// Destroys every cached backend. Intended for page unmount / navigating away
// from the holder page (see use-warm-prover.ts), so wasm memory isn't held
// for the rest of the tab's lifetime once the user is done proving.
export async function destroyAllBackends(): Promise<void> {
  await Promise.all(Array.from(backendCache.keys()).map(destroyBackend));
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
//
// Reuses the cached backend for `type` (see getBackend above) if one is
// already warm or warming, constructing one on demand otherwise. Unlike the
// original implementation, this deliberately does NOT destroy the backend
// afterwards -- the whole point of the cache is that a second proof of the
// same type (a retry, or the next credential in a batch) reuses the already-
// initialized wasm instance instead of paying construction cost again.
// Destruction is the cache owner's responsibility (see destroyBackend /
// destroyAllBackends, called from use-warm-prover.ts on unmount).
export async function proveWithBackend(
  type: CredentialType,
  witness: Uint8Array,
): Promise<GeneratedProof> {
  const backend = await getBackend(type);
  const { proof, publicInputs } = await backend.generateProof(witness, {
    keccak: true,
  });
  return { proof, publicInputs: fieldsToBytes(publicInputs) };
}

// Convenience wrapper — runs both stages in sequence.
export async function generateProof(
  type: CredentialType,
  credential: Record<string, unknown>,
): Promise<GeneratedProof> {
  const witness = await computeWitness(type, credential);
  return proveWithBackend(type, witness);
}
