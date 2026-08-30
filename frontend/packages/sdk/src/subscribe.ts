// @stellarcred/sdk — claim event subscription
//
// Issue #392: a generic, indexer-backed subscription to claim changes.
//
// `subscribeClaims` provides a single entry point that watches a wallet (or a
// specific claim type of that wallet) and fires a handler whenever the
// indexed claim state changes. It is backed by the StellarCred indexer's
// public read API (`GET /claims?wallet=…`) rather than hammering the chain
// with per-claim `hasClaim` simulations, so it scales to whole-wallet
// subscriptions.
//
// Guard-rails:
//   - Seeded (never stale): the first healthy cycle emits one `snapshot`
//     event (with `initial: true`) per claim the indexer already knows, so
//     callers are never left with claim state missing.
//   - On-the-fly creation: a claim the subscriber has not seen before is
//     emitted as `added` on a later cycle — the SDK "creates" it rather than
//     silently dropping it.
//   - Change-only: `updated` / `revoked` fire only when the claim's
//     fingerprint (verified, verified_at, expiry, revoked, reason, ledger)
//     differs from the last observation, so a no-op poll does not spam.
//   - Automatic unsubscribe: the returned object exposes `unsubscribe()`,
//     which stops polling and clears every timer.

import { normalizeAndValidateWallet } from "./wallet";

/**
 * The indexer's view of a claim, as returned by `GET /claims?wallet=…`.
 * Field names mirror the indexer response so the SDK stays a thin client of
 * the public API (no duplicated chain probing).
 */
export interface IndexedClaim {
  /** Credential type, e.g. "kyc", "age", "jurisdiction". */
  credential_type: string;
  /** Wallet address this claim belongs to. */
  wallet: string;
  /** Unix seconds when the proof was submitted on-chain. */
  verified_at?: number;
  /** Unix seconds when the record expires. */
  expiry?: number;
  /** Issuer address that signed this claim, when known. */
  issuer?: string;
  /** Ledger sequence of the transaction that last touched the claim. */
  ledger_sequence?: number;
  /** Numeric threshold (age, income, funds); null otherwise. */
  threshold?: number | null;
  /** 1 if revoked, 0 otherwise (matches the indexer's integer encoding). */
  revoked: number;
  /** Revocation reason code, when revoked (see REVOCATION_REASONS). */
  revoked_reason?: number | null;
  /** Human label for `revoked_reason`, when revoked. */
  revocation_reason_label?: string | null;
}

/**
 * The kind of a {@link ClaimEvent}.
 * - `snapshot`: part of the initial seed (marks a previously-known claim).
 * - `added`: a claim newly seen by this subscription (on-the-fly creation).
 * - `updated`: an existing claim changed state (now verified, new issuer, …).
 * - `revoked`: an existing claim became revoked.
 */
export type ClaimEventKind = "snapshot" | "added" | "updated" | "revoked";

/** A single change delivered to the subscription handler. */
export interface ClaimEvent {
  kind: ClaimEventKind;
  /** The claim that changed. */
  claim: IndexedClaim;
  /** True when this is part of the initial seed. */
  initial?: boolean;
}

/** Context passed alongside each event so handlers can correlate. */
export interface ClaimEventContext {
  /** The wallet being watched. */
  wallet: string;
  /** The specific claim type being watched, if the subscription was scoped. */
  claimType?: string;
  /** Source of the event — always "indexer" for this subscription. */
  source: "indexer";
  /** Local timestamp (ms) the event was observed. */
  observedAtMs: number;
  /** Whether the indexer returned a healthy response on this cycle. */
  indexerHealthy: boolean;
}

/**
 * Options for {@link subscribeClaims}.
 */
export interface SubscribeClaimsOptions {
  /** The wallet address to watch (G…/M…). Required. */
  wallet: string;
  /**
   * Optional claim-type filter — watch only this claim type (e.g. "kyc").
   * Omit to watch every claim for the wallet.
   */
  claimType?: string;
  /**
   * Base URL of the StellarCred indexer (its `GET /claims` read API).
   * Defaults to the `indexerUrl` configured via `configure`, or the public
   * endpoint.
   */
  indexerUrl?: string;
  /** How often to poll the indexer in milliseconds (default: 5000). */
  pollMs?: number;
  /** How long a single indexer fetch waits in ms (default: 15000). */
  requestTimeoutMs?: number;
  /**
   * Handler called on every change. To stop the subscription, call
   * {@link ClaimSubscription.unsubscribe}.
   */
  onEvent: (ctx: ClaimEventContext, event: ClaimEvent) => void;
}

/** A live claim subscription. Call {@link ClaimSubscription.unsubscribe} to stop. */
export interface ClaimSubscription {
  unsubscribe: () => void;
}

/** Optional channel to receive indexerUrl set via `configure` (internal). */
declare global {
  // eslint-disable-next-line no-var
  var __STELLARCRED_INDEXER_URL__: string | undefined;
}

/** Fields that count as "the same claim state" for change detection. */
interface ClaimFingerprint {
  verified_at?: number;
  expiry?: number;
  revoked: number;
  revoked_reason?: number | null;
  ledger_sequence?: number;
}

function fingerprint(c: IndexedClaim): ClaimFingerprint {
  return {
    verified_at: c.verified_at,
    expiry: c.expiry,
    revoked: c.revoked,
    revoked_reason: c.revoked_reason ?? null,
    ledger_sequence: c.ledger_sequence,
  };
}

function sameFingerprint(a: ClaimFingerprint, b: ClaimFingerprint): boolean {
  return (
    a.verified_at === b.verified_at &&
    a.expiry === b.expiry &&
    a.revoked === b.revoked &&
    a.revoked_reason === b.revoked_reason &&
    a.ledger_sequence === b.ledger_sequence
  );
}

/** Fetch and normalize the indexer's claim list for a wallet. */
async function fetchClaims(
  indexerUrl: string,
  wallet: string,
  requestTimeoutMs: number,
): Promise<{ healthy: boolean; claims: IndexedClaim[] }> {
  const base = indexerUrl.replace(/\/+$/, "");
  const url = `${base}/claims?wallet=${encodeURIComponent(wallet)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { healthy: false, claims: [] };
    }
    const body = (await res.json()) as { claims?: IndexedClaim[] };
    return { healthy: true, claims: Array.isArray(body.claims) ? body.claims : [] };
  } catch {
    return { healthy: false, claims: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Subscribe to claim changes for a wallet, backed by the StellarCred indexer.
 *
 * Fires `onEvent(ctx, event)`:
 *   - First healthy cycle → one `snapshot` event (with `initial: true`) per
 *     known claim, seeding local state (never stale).
 *   - Later, newly-seen claims → `added`; state-changed claims → `updated`;
 *     claims that became revoked → `revoked`. A claim that disappears from
 *     the indexer after previously existing is defensively surfaced as
 *     `revoked` (it was purged/expired, not silently lost).
 *
 * Returns `{ unsubscribe }`; calling it stops polling and clears all timers.
 *
 * @example
 * useEffect(() => {
 *   const sub = StellarCred.subscribeClaims({
 *     wallet,
 *     onEvent: (ctx, event) => {
 *       if (event.kind === "revoked") console.log("revoked:", event.claim);
 *     },
 *   });
 *   return () => sub.unsubscribe();
 * }, [wallet]);
 */
export function subscribeClaims(options: SubscribeClaimsOptions): ClaimSubscription {
  const walletInput = options.wallet;

  const pollMs = options.pollMs ?? 5000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  const claimType = options.claimType;

  const indexerUrl =
    (options.indexerUrl ?? (globalThis.__STELLARCRED_INDEXER_URL__ as string | undefined) ?? "")
      .replace(/\/+$/, "") || "https://api.stellarcred.xyz";

  let stopped = false;
  let inFlight = false;
  let walletValidated = false;
  let wallet: string | null = null;
  const timerIds: Array<ReturnType<typeof setTimeout>> = [];
  const known = new Map<string, ClaimFingerprint>();
  let firstGoodCycle = true;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const id of timerIds) clearTimeout(id);
    timerIds.length = 0;
  };

  const emit = (ctx: ClaimEventContext, event: ClaimEvent) => {
    if (stopped) return;
    try {
      options.onEvent(ctx, event);
    } catch (err) {
      // A throwing handler must not kill the subscription loop.
      // eslint-disable-next-line no-console
      console.error("[StellarCred:subscribeClaims] handler threw:", err);
    }
  };

  const cycle = async () => {
    if (stopped || inFlight) return;
    inFlight = true;

    // Validate the wallet once (lazy async SDK import). If the address is
    // malformed we cannot watch a valid account — stop cleanly rather than
    // leaving a stale loop polling forever.
    if (!walletValidated) {
      try {
        wallet = await normalizeAndValidateWallet(walletInput);
        walletValidated = true;
      } catch {
        stop();
        inFlight = false;
        return;
      }
    }

    const { healthy, claims } = await fetchClaims(indexerUrl, wallet!, requestTimeoutMs);

    if (stopped) {
      inFlight = false;
      return;
    }

    const scoped = claimType
      ? claims.filter((c) => c.credential_type === claimType)
      : claims;

    const ctx: ClaimEventContext = {
      wallet: wallet!,
      claimType,
      source: "indexer",
      observedAtMs: Date.now(),
      indexerHealthy: healthy,
    };

    const liveTypes = new Set<string>();
    const isFirst = firstGoodCycle;

    for (const claim of scoped) {
      if (!healthy) {
        // Skip diffing on an unhealthy cycle; keep the last known state.
        continue;
      }
      const type = claim.credential_type;
      liveTypes.add(type);
      const prior = known.get(type);

      if (prior === undefined) {
        // First-seen claim. Seed it and mark snapshot/add so the caller is
        // never left with missing claim state (never stale).
        const initial = isFirst;
        known.set(type, fingerprint(claim));
        emit(ctx, { kind: initial ? "snapshot" : "added", claim, initial });
        continue;
      }

      const fp = fingerprint(claim);
      if (sameFingerprint(prior, fp)) continue;

      // Real change: update and report.
      known.set(type, fp);
      if (claim.revoked === 1 && prior.revoked === 0) {
        emit(ctx, { kind: "revoked", claim });
      } else {
        emit(ctx, { kind: "updated", claim });
      }
    }

    // Defensive disappearance detection (after the first good cycle): a
    // previously-known, non-revoked claim that the indexer no longer reports
    // was purged/expired — surface it as `revoked` so the subscriber is not
    // left believing a stale live claim existed.
    if (healthy && !firstGoodCycle) {
      for (const [type, prior] of known) {
        if (!liveTypes.has(type) && prior.revoked === 0) {
          known.delete(type);
          const ghost: IndexedClaim = {
            credential_type: type,
            wallet: wallet!,
            verified_at: prior.verified_at,
            expiry: prior.expiry,
            revoked: 1,
            revoked_reason: 50,
            revocation_reason_label: "other",
          };
          emit(ctx, { kind: "revoked", claim: ghost });
        }
      }
    }

    if (healthy) firstGoodCycle = false;

    inFlight = false;
    if (!stopped) timerIds.push(setTimeout(() => void cycle(), pollMs));
  };

  timerIds.push(setTimeout(() => void cycle(), 0));

  return { unsubscribe: stop };
}
