/**
 * config.ts — Load and validate all environment configuration.
 * Every other module imports from here; never from process.env directly.
 */

export type DbDriver = "sqlite" | "postgres";

export interface Config {
  stellarNetwork: string;
  horizonUrl: string;
  rpcUrl: string;
  proofRegistryContractId: string;
  dbDriver: DbDriver;
  sqlitePath: string;
  databaseUrl: string | undefined;
  pollIntervalMs: number;
  startLedger: number;
  port: number;
  /**
   * Number of ledgers to lag behind the network head before persisting.
   * This prevents near-head volatility (reorgs) from being indexed prematurely.
   * Default: 6 (≈30 seconds at ~5 s/ledger on Stellar).
   */
  finalityLag: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  rateLimitEnabled: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function parseCorsOrigins(raw?: string): string[] {
  if (!raw || raw.trim() === "") {
    if (process.env.NODE_ENV === "production") {
      return [];
    }
    return ["http://localhost:3000"];
  }

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(): Config {
  const driver = optional("DB_DRIVER", "sqlite") as DbDriver;
  if (driver !== "sqlite" && driver !== "postgres") {
    throw new Error(`DB_DRIVER must be "sqlite" or "postgres", got: ${driver}`);
  }

  const rawCors = process.env["CORS_ALLOWED_ORIGINS"] ?? process.env["CORS_ORIGIN"];
  const windowSec = Number(optional("RATE_LIMIT_WINDOW_SECONDS", "60"));
  const maxReq = Number(
    process.env["RATE_LIMIT_MAX"] ??
      process.env["RATE_LIMIT_MAX_REQUESTS"] ??
      "120"
  );
  const rateLimitEnabled =
    optional("RATE_LIMIT_ENABLED", "true").toLowerCase() !== "false";

  return {
    stellarNetwork: optional("STELLAR_NETWORK", "testnet"),
    horizonUrl: optional(
      "HORIZON_URL",
      "https://horizon-testnet.stellar.org"
    ),
    rpcUrl: optional("RPC_URL", "https://soroban-testnet.stellar.org"),
    proofRegistryContractId: required("PROOF_REGISTRY_CONTRACT_ID"),
    dbDriver: driver,
    sqlitePath: optional("SQLITE_PATH", "./data/indexer.db"),
    databaseUrl: process.env["DATABASE_URL"],
    pollIntervalMs:
      Number(optional("POLL_INTERVAL_SECONDS", "6")) * 1000,
    startLedger: Number(optional("START_LEDGER", "0")),
    port: Number(optional("PORT", "3001")),
    finalityLag: Number(optional("FINALITY_LAG", "6")),
    corsOrigins: parseCorsOrigins(rawCors),
    rateLimitWindowMs: (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 60) * 1000,
    rateLimitMax: Number.isFinite(maxReq) && maxReq > 0 ? maxReq : 120,
    rateLimitEnabled,
  };
}
