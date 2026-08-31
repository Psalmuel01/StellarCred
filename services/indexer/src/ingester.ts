/**
 * ingester.ts — Poll Horizon for ProofRegistry contract events and write them
 * into the local DB.
 *
 * ProofRegistry emits two kinds of events:
 *
 *   Verified  topics: ["proof", "verified"]  value: expiry (u64)
 *   Revoked   topics: ["revoked"]            value: (holder, cred_type, issuer, ts)
 *
 * Horizon's /effects and /transactions endpoints don't surface Soroban contract
 * events natively, so we use the dedicated
 *   GET /contracts/{contract_id}/events
 * endpoint introduced alongside Protocol 20 / Soroban.
 *
 * Idempotency: every cycle starts from (lastLedger + 1) and advances the cursor
 * only after all rows for that ledger have been written. Restarting replays from
 * the last saved cursor; duplicate events are absorbed by upsertClaim's
 * ON CONFLICT DO UPDATE clause.
 */

import { Horizon } from "@stellar/stellar-sdk";
import type { Config } from "./config";
import type { Db } from "./db";

// ── Retry configuration ───────────────────────────────────────────────────

/** Maximum number of fetch attempts per tick (1 = no retry). */
const MAX_RETRIES = 3;

/** Base delay in ms before the first retry (doubled each subsequent attempt). */
const BASE_RETRY_DELAY_MS = 500;

/** Maximum single-retry delay (caps exponential growth). */
const MAX_RETRY_DELAY_MS = 8_000;

// ── Health / lag observability ─────────────────────────────────────────────

export interface IngesterHealth {
  /** Ledger sequence of the last successfully processed event. 0 if none. */
  lastSuccessLedger: number;
  /** Current Horizon head ledger (best-effort, fetched once per tick). */
  headLedger: number;
  /** `headLedger - lastSuccessLedger` or -1 if head is unknown. */
  lag: number;
  /** Human-readable message from the most recent failed fetch, if any. */
  lastError: string | null;
  /** Timestamp (ms) of the most recent failed fetch. */
  lastErrorTime: number | null;
  /** How many consecutive ticks have failed (0 = healthy). */
  consecutiveErrors: number;
  /** Total fetch attempts (including retries) since start. */
  fetchAttempts: number;
  /** Total failed fetch attempts (all retries exhausted) since start. */
  fetchFailures: number;
}

function freshHealth(): IngesterHealth {
  return {
    lastSuccessLedger: 0,
    headLedger: 0,
    lag: -1,
    lastError: null,
    lastErrorTime: null,
    consecutiveErrors: 0,
    fetchAttempts: 0,
    fetchFailures: 0,
  };
}

// ── Horizon event shape ────────────────────────────────────────────────────

interface HorizonContractEvent {
  paging_token: string;
  contract_id: string;
  topic: string[];
  value: string;
  ledger: number | string;
  ledger_closed_at: string;
  transaction_hash?: string;
  source_account?: string;
}

interface HorizonEventsPage {
  _embedded: { records: HorizonContractEvent[] };
}

/** Horizon root response — used to read the current ledger. */
interface HorizonRoot {
  core_latest_ledger: number;
}

// ── XDR decode helpers ─────────────────────────────────────────────────────

function decodeScVal(b64: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { xdr, Address, scValToNative } = require(
      "@stellar/stellar-sdk"
    ) as typeof import("@stellar/stellar-sdk");

    const scval = xdr.ScVal.fromXDR(b64, "base64");
    const native: unknown = scValToNative(scval);

    if (native instanceof Address) {
      return native.toString();
    }
    if (typeof native === "bigint") {
      return Number(native);
    }
    return native;
  } catch {
    return null;
  }
}

// ── Retry helper ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: unknown): boolean {
  const msg = (err as Error).message?.toLowerCase() ?? "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("terminated") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

async function fetchEventsWithRetry(
  url: string,
  signal: AbortSignal,
  retries = MAX_RETRIES,
  attempt = 1,
): Promise<HorizonEventsPage> {
  try {
    const res = await fetch(url, { signal });
    if (res.ok) {
      return (await res.json()) as HorizonEventsPage;
    }
    if (res.status === 404) {
      return { _embedded: { records: [] } };
    }
    if (res.status === 429 || res.status >= 500) {
      if (retries <= 0) {
        const text = await res.text().catch(() => "");
        throw new Error(`Horizon responded ${res.status} after ${attempt} attempts: ${text}`);
      }
      const retryAfter = res.headers.get("retry-after");
      const delayMs = retryAfter
        ? Math.min(Number(retryAfter) * 1000, MAX_RETRY_DELAY_MS)
        : Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
      console.warn(
        `[indexer] Horizon ${res.status} on attempt ${attempt}/${attempt + retries}, retrying in ${delayMs}ms…`,
      );
      await sleep(delayMs);
      return fetchEventsWithRetry(url, signal, retries - 1, attempt + 1);
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Horizon responded ${res.status}: ${text}`);
  } catch (err) {
    if (!isTransientError(err) || retries <= 0) {
      throw err;
    }
    const delayMs = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
      MAX_RETRY_DELAY_MS,
    );
    console.warn(
      `[indexer] transient fetch error on attempt ${attempt}/${attempt + retries}: ${(err as Error).message}; retrying in ${delayMs}ms…`,
    );
    await sleep(delayMs);
    return fetchEventsWithRetry(url, signal, retries - 1, attempt + 1);
  }
}

// ── Event parser ───────────────────────────────────────────────────────────

type ParsedEvent =
  | {
      kind: "verified";
      holder: string;
      credentialType: string;
      issuer: string;
      expiry: number;
      ledgerSequence: number;
      verifiedAt: number;
    }
  | {
      kind: "revoked";
      holder: string;
      credentialType: string;
    }
  | { kind: "unknown" };

function parseEvent(ev: HorizonContractEvent, contractId: string): ParsedEvent {
  if (ev.contract_id !== contractId) return { kind: "unknown" };

  const topics = ev.topic.map(decodeScVal);
  const value = decodeScVal(ev.value);
  const ledgerSequence =
    typeof ev.ledger === "string" ? parseInt(ev.ledger, 10) : ev.ledger;

  if (topics[0] === "proof" && topics[1] === "verified") {
    const holder = ev.source_account ?? "";
    const credentialType = typeof topics[2] === "string" ? topics[2] : "unknown";
    const expiry = typeof value === "number" ? value : 0;

    return {
      kind: "verified",
      holder,
      credentialType,
      issuer: "",
      expiry,
      ledgerSequence,
      verifiedAt: Math.floor(new Date(ev.ledger_closed_at).getTime() / 1000),
    };
  }

  if (topics[0] === "revoked") {
    if (Array.isArray(value) && value.length >= 2) {
      const holder = String(value[0]);
      const credentialType = String(value[1]);
      return { kind: "revoked", holder, credentialType };
    }
  }

  return { kind: "unknown" };
}

// ── Ingester ────────────────────────────────────────────────────────────────

export interface Ingester {
  /** Run one ingestion cycle (fetch + write). Returns number of events processed. */
  tick(): Promise<number>;
  /**
   * Re-scan a bounded window of ledgers to reconcile after a detected reorg.
   * Deletes claims newer than `reorgPoint` and re-indexes up to the new head.
   */
  reconcile(reorgPoint: number): Promise<number>;
  /** Start a continuous polling loop. */
  start(): void;
  /** Stop the polling loop. */
  stop(): void;
  /** Graceful shutdown: stop scheduling and await in-flight tick. */
  shutdown(): Promise<void>;
  /** Current health snapshot — safe to read at any time. */
  getHealth(): IngesterHealth;
}

export function createIngester(config: Config, db: Db): Ingester {
  const server = new Horizon.Server(config.horizonUrl, {
    allowHttp: config.horizonUrl.startsWith("http://"),
  });

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlightTick: Promise<number> | null = null;
  const health = freshHealth();

  // ── Fetch current Horizon head ledger (cached per tick) ────────────────
  let cachedHeadLedger = 0;
  let cachedHeadTime = 0;
  const HEAD_CACHE_MS = 30_000;

  async function fetchHeadLedger(): Promise<number> {
    const now = Date.now();
    if (cachedHeadLedger > 0 && now - cachedHeadTime < HEAD_CACHE_MS) {
      return cachedHeadLedger;
    }
    try {
      const res = await fetch(config.horizonUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const root = (await res.json()) as HorizonRoot;
        const seq = root.core_latest_ledger ?? 0;
        if (seq > 0) {
          cachedHeadLedger = seq;
          cachedHeadTime = now;
        }
      }
    } catch {
      // Best-effort
    }
    return cachedHeadLedger;
  }

  async function getLedgerHead(): Promise<number> {
    const url = new URL("/ledgers", config.horizonUrl);
    url.searchParams.set("order", "desc");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Horizon /ledgers responded ${res.status}`);
    }
    const body = (await res.json()) as {
      _embedded?: { records?: Array<{ sequence: number | string }> };
    };
    const seq = body._embedded?.records?.[0]?.sequence;
    if (seq === undefined) throw new Error("No ledger returned from Horizon");
    return typeof seq === "string" ? parseInt(seq, 10) : seq;
  }

  async function fetchEvents(
    cursor: string | undefined,
    maxLedger: number
  ): Promise<HorizonContractEvent[]> {
    const url = new URL(
      `/contracts/${config.proofRegistryContractId}/events`,
      config.horizonUrl
    );
    url.searchParams.set("order", "asc");
    url.searchParams.set("limit", "200");
    if (cursor !== undefined) {
      url.searchParams.set("cursor", cursor);
    }

    health.fetchAttempts++;
    try {
      const page = await fetchEventsWithRetry(url.toString(), AbortSignal.timeout(15_000));
      const records = page._embedded?.records ?? [];
      if (records.length === 0) {
        health.consecutiveErrors = 0;
        health.lastError = null;
        health.headLedger = cachedHeadLedger;
        health.lag = cachedHeadLedger > 0 ? cachedHeadLedger - maxLedger : -1;
        return [];
      }
      return records.filter((ev) => {
        const evLedger = typeof ev.ledger === "string" ? parseInt(ev.ledger, 10) : ev.ledger;
        return evLedger <= maxLedger;
      });
    } catch (err) {
      health.lastError = (err as Error).message;
      health.lastErrorTime = Date.now();
      health.consecutiveErrors++;
      health.fetchFailures++;
      throw err;
    }
  }

  async function processEvents(events: HorizonContractEvent[]): Promise<number> {
    let processed = 0;
    for (const ev of events) {
      const parsed = parseEvent(ev, config.proofRegistryContractId);

      if (parsed.kind === "verified") {
        await db.upsertClaim({
          wallet: parsed.holder,
          credential_type: parsed.credentialType,
          issuer: parsed.issuer,
          verified_at: parsed.verifiedAt,
          expiry: parsed.expiry,
          ledger_sequence: parsed.ledgerSequence,
          threshold: null,
          revoked: 0,
        });
        processed++;
      } else if (parsed.kind === "revoked") {
        await db.revokeClaim(parsed.holder, parsed.credentialType);
        processed++;
      }
    }
    return processed;
  }

  async function tick(): Promise<number> {
    const lastLedger = await db.getLastLedger();

    let headLedger: number;
    try {
      headLedger = await getLedgerHead();
    } catch (err) {
      console.warn("[indexer] Could not fetch ledger head:", (err as Error).message);
      return 0;
    }

    const finalityCeiling = headLedger - config.finalityLag;
    if (finalityCeiling <= lastLedger) {
      return 0;
    }

    if (lastLedger > headLedger) {
      console.warn(
        `[indexer] REORG DETECTED: cursor=${lastLedger} > head=${headLedger}. Rolling back and re-scanning.`
      );
      return reconcile(headLedger);
    }

    const cursorNum = lastLedger > 0 ? lastLedger * 100_000 : 0;
    const cursor =
      config.startLedger > 0 && lastLedger === 0
        ? String(config.startLedger * 100_000)
        : cursorNum > 0
        ? String(cursorNum)
        : undefined;

    let events: HorizonContractEvent[];
    try {
      events = await fetchEvents(cursor, finalityCeiling);
    } catch (err) {
      console.warn("[indexer] Horizon fetch error:", (err as Error).message);
      return 0;
    }

    if (events.length === 0) return 0;

    const processed = await processEvents(events);

    let maxLedger = lastLedger;
    for (const ev of events) {
      const evLedger = typeof ev.ledger === "string" ? parseInt(ev.ledger, 10) : ev.ledger;
      if (evLedger > maxLedger) maxLedger = evLedger;
    }
    if (maxLedger > lastLedger) {
      await db.setLastLedger(maxLedger);
    }

    health.lastSuccessLedger = maxLedger;
    health.headLedger = cachedHeadLedger;
    health.lag = cachedHeadLedger > 0 ? cachedHeadLedger - maxLedger : -1;
    health.consecutiveErrors = 0;
    health.lastError = null;

    return processed;
  }

  async function reconcile(reorgPoint: number): Promise<number> {
    console.log(`[indexer] Reconciling from ledger ${reorgPoint}`);
    await db.deleteClaimsAfter(reorgPoint);
    await db.setLastLedger(reorgPoint);
    return tick();
  }

  function scheduleNext() {
    timer = setTimeout(async () => {
      if (!running) return;
      try {
        inFlightTick = tick();
        const n = await inFlightTick;
        if (n > 0) {
          console.log(`[indexer] processed ${n} event(s)`);
        }
      } catch (err) {
        console.error("[indexer] tick error:", err);
      }
      scheduleNext();
    }, config.pollIntervalMs);
  }

  return {
    tick,
    reconcile,
    start() {
      if (running) return;
      running = true;
      console.log(
        `[indexer] starting — contract=${config.proofRegistryContractId} ` +
          `network=${config.stellarNetwork} poll=${config.pollIntervalMs}ms`
      );
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async shutdown() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlightTick !== null) {
        console.log("[indexer] Waiting for in-flight tick…");
        await inFlightTick;
      }
      console.log("[indexer] Ingester stopped.");
    },
    getHealth() {
      return { ...health };
    },
  };
}