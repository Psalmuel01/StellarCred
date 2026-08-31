"use client";

// Warms the UltraHonk prover for the holder page's unproved credential types
// in the background, so the wasm backend is already constructed by the time
// the user clicks "Prove" — see lib/proof.ts's backendCache. Trigger and
// lifecycle live here rather than in proof.ts so proof.ts stays a plain
// data/cache module with no React dependency.

import { useEffect } from "react";
import { warmBackend, destroyAllBackends } from "./proof";
import type { CredentialType } from "./stellar";

/**
 * Kicks off background warming for each of `types` once `enabled` is true
 * (the holder page passes the wallet's connected state — never warm before
 * that, and never before crossOriginIsolated is knowable, which proof.ts
 * itself reads live at construction time rather than assuming here).
 *
 * Warming is fire-and-forget: it doesn't block render and never throws (see
 * warmBackend). Repeated calls for the same type — including the effect
 * re-running under React StrictMode's mount/unmount/mount, or a real prove
 * click racing an in-flight warm — share the single in-flight construction
 * via lib/proof.ts's cache, so nothing is ever double-constructed.
 *
 * This hook also owns the cache's teardown: since lib/proof.ts's backendCache
 * is module-scoped (shared for the whole tab), something has to decide when
 * to stop holding onto warmed/proved backends. This hook is that owner —
 * every cached backend is destroyed when the calling component unmounts
 * (e.g. SPA navigation away from the holder page) or the tab is closed/
 * reloaded (`beforeunload`). Only mount the holder page's warming from one
 * place, or an earlier unmount will tear down backends a later mount still
 * expects to be warm.
 */
export function useWarmProver(types: CredentialType[], enabled: boolean): void {
  // Stable key so the warm effect only re-fires when the *set* of types
  // actually changes, not on every render that happens to pass a new array
  // instance with the same contents.
  const key = types.join(",");

  useEffect(() => {
    if (!enabled) return;
    for (const type of types) {
      warmBackend(type);
    }
    // `types` intentionally excluded: `key` is the derived, order/content-
    // stable dependency that should actually re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // Separate, mount/unmount-only effect: registers the tab-close cleanup
  // once and tears every cached backend down when this hook's owner
  // unmounts, regardless of how many times the warm effect above re-ran.
  useEffect(() => {
    const handleUnload = () => {
      void destroyAllBackends();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      void destroyAllBackends();
    };
  }, []);
}
