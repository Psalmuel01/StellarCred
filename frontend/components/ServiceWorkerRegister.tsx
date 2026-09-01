"use client";

import { useEffect } from "react";

/**
 * Registers the StellarCred service worker on mount.
 * The SW lives in /public/sw.js and is served without the page's Content-Security-Policy
 * (see next.config.mjs sw-src allowlist). It caches the app shell (/_next/static/,
 * /holder, /manifest.webmanifest, icons) but deliberately never caches
 * /api/* routes or credential data — those always go over the network.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => {
        // Service worker registration can fail in restricted environments (e.g.
        // some corporate proxies, Firefox private browsing without the service
        // workers pref). Gracefully degrade — the app still works, just without
        // offline support.
        console.warn("[SW] Registration failed:", err);
      });
  }, []);

  return null;
}
