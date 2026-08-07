/**
 * Theme helpers for StellarCred.
 *
 * Storage contract:
 * - `localStorage.theme` ∈ { "light", "dark" }  → explicit user preference (wins forever until cleared)
 * - missing / invalid                              → follow `prefers-color-scheme`
 *
 * The boot script below must stay in sync with {@link resolveTheme} so the
 * inline `<head>` injector and the React toggle never disagree.
 */

export const THEME_STORAGE_KEY = "theme";
export type Theme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Read an explicit user preference, or `null` when the OS should decide. */
export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // private mode / blocked storage — treat as "no preference"
    return null;
  }
}

/** Current OS preference via `prefers-color-scheme`. */
export function getSystemTheme(
  matchMedia: (query: string) => MediaQueryList = (q) => window.matchMedia(q),
): Theme {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

/**
 * Resolve the theme that should be active right now:
 * explicit localStorage choice if present, otherwise the OS setting.
 */
export function resolveTheme(
  matchMedia: (query: string) => MediaQueryList = (q) => window.matchMedia(q),
): Theme {
  return getStoredTheme() ?? getSystemTheme(matchMedia);
}

/** Apply `data-theme` on `<html>`. No-op during SSR. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/** Persist an explicit user choice and apply it. */
export function setExplicitTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // still applied to the DOM even if storage is unavailable
  }
}

/**
 * Blocking boot script for `<head>` — runs before first paint to avoid a
 * flash of the wrong theme. Keep this string self-contained (no imports).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){try{document.documentElement.setAttribute("data-theme",window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}catch(_){document.documentElement.setAttribute("data-theme","dark");}}})();`;
