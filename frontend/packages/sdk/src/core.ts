// @stellarcred/sdk — framework-agnostic core
//
// `createClaimGate` is the framework-agnostic entry point for gating UI on
// verified claims. It exposes subscribe/unsubscribe so any framework (React,
// Vue, Svelte, vanilla JS) can react to claim state changes. No React import.
//
//   import { createClaimGate } from "@stellarcred/sdk";
//
//   const gate = createClaimGate({ wallet: "G…" });
//   gate.subscribe((state) => console.log(state));
//   // later: gate.destroy();

import { hasClaim, type ClaimType } from "./claims";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClaimGateConfig {
  /** Wallet address to check claims for. Null means no wallet connected. */
  wallet: string | null;
  /** Which claim types to check. Defaults to all CLAIM_TYPES. */
  claims?: ClaimType[];
  /** Minimum thresholds for parameterised claims (age, income, funds). */
  minThresholds?: Partial<Record<ClaimType, number>>;
}

export interface ClaimGateState {
  /** Map of claim type → verified status. null means not yet fetched. */
  claims: Partial<Record<ClaimType, boolean>> | null;
  /** True while a claim-check is in flight. */
  loading: boolean;
  /** Set on network errors; cleared on refetch. */
  error: Error | null;
}

export type ClaimGateListener = (state: ClaimGateState) => void;

export interface ClaimGate {
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: ClaimGateListener): () => void;
  /** Remove a previously-registered listener. */
  unsubscribe(listener: ClaimGateListener): void;
  /** Return the current state synchronously. */
  getSnapshot(): ClaimGateState;
  /** Re-run all claim checks. */
  refetch(): void;
  /** Stop all polling and clear listeners. Call on teardown. */
  destroy(): void;
}

const DEFAULT_CLAIMS: ClaimType[] = [
  "kyc", "age", "jurisdiction", "income", "funds",
];

// ── Implementation ───────────────────────────────────────────────────────────

export function createClaimGate(config: ClaimGateConfig): ClaimGate {
  const { wallet } = config;
  const claimsToCheck = config.claims ?? DEFAULT_CLAIMS;
  const thresholds = config.minThresholds ?? {};

  const listeners = new Set<ClaimGateListener>();
  let state: ClaimGateState = { claims: null, loading: true, error: null };
  let destroyed = false;
  // Monotonic fetch id — lets an older in-flight fetch detect that a newer
  // one has started and discard its (stale) results instead of overwriting
  // fresher data (last-write-wins race on concurrent refetch()).
  let fetchId = 0;

  function emit() {
    // Snapshot so listeners can't mutate our internal state.
    const snap: ClaimGateState = {
      claims: state.claims ? { ...state.claims } : null,
      loading: state.loading,
      error: state.error,
    };
    listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // Don't let one broken listener break the others.
      }
    });
  }

  function setState(partial: Partial<ClaimGateState>) {
    state = { ...state, ...partial };
    emit();
  }

  async function fetchClaims() {
    const myId = ++fetchId;
    if (!wallet) {
      setState({ claims: null, loading: false, error: null });
      return;
    }

    setState({ loading: true, error: null });

    const results: Partial<Record<ClaimType, boolean>> = {};

    await Promise.all(
      claimsToCheck.map(async (claimType) => {
        if (destroyed || myId !== fetchId) return;
        try {
          const ok = await hasClaim(wallet, claimType, {
            minThreshold: thresholds[claimType],
          });
          if (!destroyed && myId === fetchId) results[claimType] = ok;
        } catch {
          if (!destroyed && myId === fetchId) results[claimType] = false;
        }
      }),
    );

    // Discard results if a newer fetch started (or we were destroyed) while
    // this one was in flight.
    if (!destroyed && myId === fetchId) {
      setState({ claims: results, loading: false });
    }
  }

  // Initial fetch.
  fetchClaims();

  return {
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      // Push current state immediately.
      try {
        listener({
          claims: state.claims ? { ...state.claims } : null,
          loading: state.loading,
          error: state.error,
        });
      } catch { /* noop */ }
      return () => { listeners.delete(listener); };
    },

    unsubscribe(listener) {
      listeners.delete(listener);
    },

    getSnapshot() {
      return {
        claims: state.claims ? { ...state.claims } : null,
        loading: state.loading,
        error: state.error,
      };
    },

    refetch() {
      if (destroyed) return;
      fetchClaims();
    },

    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
}
