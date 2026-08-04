/**
 * Test fixtures for the @stellarcred/sdk integration test suite.
 *
 * All values come from environment variables so tests run against the live
 * testnet deployment without hardcoded addresses. When the required env vars
 * are absent, tests skip gracefully — no failing CI on forks.
 *
 * Required env vars:
 *   SC_TEST_WALLET               – a funded Stellar testnet wallet address
 *                                 (should have at least one verified KYC proof)
 *   STELLARCRED_REGISTRY_ID      – deployed ProofRegistry contract ID
 *     (or NEXT_PUBLIC_PROOF_REGISTRY_ID)
 */

function env(key: string, nextPublicKey?: string): string {
  if (typeof process === "undefined") return "";
  return (
    (process.env as Record<string, string | undefined>)[key] ??
    (nextPublicKey
      ? ((process.env as Record<string, string | undefined>)[nextPublicKey] ?? "")
      : "")
  );
}

/** A pre-verified wallet address that has at least one KYC proof on testnet. */
export const TEST_WALLET = env("SC_TEST_WALLET");

/** ProofRegistry contract ID. */
export const REGISTRY_ID =
  env("STELLARCRED_REGISTRY_ID", "NEXT_PUBLIC_PROOF_REGISTRY_ID") ||
  "";

/** RPC URL for testnet simulation. */
export const RPC_URL =
  env("STELLARCRED_RPC_URL", "NEXT_PUBLIC_RPC_URL") ||
  "https://soroban-testnet.stellar.org";
