"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkClaim } from "@/lib/contracts";
import type { Requirement } from "@/lib/protocols";

/** Per-card (or per-protocol) access-check lifecycle. */
export type AccessCheckState = "idle" | "loading" | "granted" | "denied" | "error";

const DEBOUNCE_MS = 300;

/**
 * Runs on-chain `check_claim` for each requirement with:
 * - immediate `loading` on wallet/network change (no flicker of stale granted/denied)
 * - debounced RPC so rapid wallet/network flips don't hammer the node
 * - `error` (not false `denied`) when the read throws
 */
export function useProtocolAccessCheck(
  requirements: Requirement[],
  activeWallet: string | null,
  opts: { isPreview?: boolean; networkKey?: string | boolean } = {},
) {
  const { isPreview = false, networkKey } = opts;

  const [state, setState] = useState<AccessCheckState>("idle");
  const [statuses, setStatuses] = useState<boolean[]>(() =>
    requirements.map(() => false),
  );
  const [retryNonce, setRetryNonce] = useState(0);

  // Stable fingerprint so parent re-renders with the same requirements don't re-fire.
  const reqKey = requirements.map((r) => `${r.type}:${r.minThreshold ?? ""}`).join("|");
  const reqRef = useRef(requirements);
  reqRef.current = requirements;

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const reqs = reqRef.current;

    if (isPreview) {
      setStatuses(reqs.map(() => true));
      setState("granted");
      return;
    }

    if (!activeWallet) {
      setStatuses(reqs.map(() => false));
      setState("idle");
      return;
    }

    // Drop any previous granted/denied immediately so the UI never flashes.
    setState("loading");

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = await Promise.all(
            reqs.map((r) => checkClaim(activeWallet, r.type, r.minThreshold)),
          );
          if (cancelled) return;
          setStatuses(results);
          setState(results.every(Boolean) ? "granted" : "denied");
        } catch {
          if (cancelled) return;
          // Keep prior requirement booleans but surface error — never treat RPC
          // failure as a definitive "denied".
          setState("error");
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWallet, isPreview, networkKey, reqKey, retryNonce]);

  return {
    state,
    statuses,
    retry,
    eligible: state === "granted",
    checking: state === "loading",
  };
}
