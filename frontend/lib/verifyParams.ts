/**
 * lib/verifyParams.ts
 *
 * Pure validation helpers for /verify query params.
 * Extracted so they can be unit-tested independently of the React component.
 */

/** Credential types the circuit set supports. Keep in sync with TYPE_META. */
export const VALID_CLAIM_TYPES = [
  "kyc",
  "age",
  "income",
  "jurisdiction",
  "funds",
  "accreditation",
] as const;
export type ValidClaimType = (typeof VALID_CLAIM_TYPES)[number];

/** ISO 3166-1 numeric codes are 1–999. */
const ISO_NUMERIC_RE = /^\d{1,3}$/;

/**
 * Validate a return_url supplied as a query param.
 *
 * Rules:
 * - Relative paths (starting with `/`) are always accepted (same-origin redirect).
 * - Absolute URLs must use `https:` or `http:` (blocks javascript:, data:, etc.).
 * - `http:` is allowed only when the redirect target is the same origin as the
 *   current page (e.g. localhost dev setups).
 * - Never pass external return_url values to router.push — use window.location.href.
 *
 * @returns `{ ok: true }` on success, `{ ok: false, error: string }` on failure.
 */
export function validateReturnUrl(
  returnUrl: string,
  currentOrigin?: string
): { ok: true } | { ok: false; error: string } {
  if (!returnUrl) return { ok: true }; // no return_url is fine — will fall back to /holder

  // Relative same-origin paths are always safe
  if (returnUrl.startsWith("/")) {
    return { ok: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    return { ok: false, error: "Invalid return URL: must be a well-formed URL." };
  }

  // Only http: and https: are allowed — block javascript:, data:, blob:, etc.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: `Invalid return URL: "${parsed.protocol}" scheme is not allowed. Use https://.`,
    };
  }

  // Allow http: only when the redirect stays on the same origin (e.g. localhost)
  if (parsed.protocol === "http:") {
    const origin = currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
    if (origin && parsed.origin !== origin) {
      return {
        ok: false,
        error: "Invalid return URL: external http:// URLs are not allowed. Use https://.",
      };
    }
  }

  return { ok: true };
}

/**
 * Validate the `claim` query param.
 * Returns `null` when the claim is missing or invalid (caller should fall back to default).
 */
export function validateClaimParam(
  claim: string | null | undefined
): ValidClaimType | null {
  if (!claim) return null;
  return (VALID_CLAIM_TYPES as readonly string[]).includes(claim)
    ? (claim as ValidClaimType)
    : null;
}

/**
 * Validate a numeric threshold param (`threshold_years`, `threshold`).
 *
 * @param raw   Raw query-param string value.
 * @param opts  Optional min/max constraints.
 * @returns `{ ok: true, value: number }` or `{ ok: false, error: string }`.
 */
export function validateNumericParam(
  raw: string | null | undefined,
  opts: { name: string; min?: number; max?: number; integer?: boolean } = { name: "value" }
): { ok: true; value: number } | { ok: false; error: string } | { ok: true; value: undefined } {
  if (raw == null || raw === "") return { ok: true, value: undefined };

  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    return { ok: false, error: `Invalid ${opts.name}: must be a number, got "${raw}".` };
  }
  if (opts.integer !== false && !Number.isInteger(n)) {
    return { ok: false, error: `Invalid ${opts.name}: must be a whole number, got "${raw}".` };
  }
  const min = opts.min ?? 1;
  if (n < min) {
    return { ok: false, error: `Invalid ${opts.name}: must be ≥ ${min}, got ${n}.` };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { ok: false, error: `Invalid ${opts.name}: must be ≤ ${opts.max}, got ${n}.` };
  }
  return { ok: true, value: n };
}

/**
 * Validate the `restricted` query param (comma-separated ISO 3166-1 numeric codes).
 *
 * Constraints:
 * - At most 8 entries (circuit hard limit: `RESTRICTED_LEN = 8`).
 * - Each entry must be a 1–3 digit numeric string (ISO 3166-1 numeric).
 *
 * @returns `{ ok: true, codes: string[] }` or `{ ok: false, error: string }`.
 */
export function validateRestrictedList(
  raw: string | null | undefined
): { ok: true; codes: string[] } | { ok: false; error: string } {
  if (!raw) return { ok: true, codes: [] };

  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (entries.length > 8) {
    return {
      ok: false,
      error: `Invalid restricted list: at most 8 country codes allowed, got ${entries.length}.`,
    };
  }

  const invalid = entries.filter((e) => !ISO_NUMERIC_RE.test(e));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid restricted list: entries must be numeric ISO 3166-1 codes (1–3 digits). Invalid: ${invalid.slice(0, 5).join(", ")}.`,
    };
  }

  return { ok: true, codes: entries };
}

/** Collect all param validation errors for the /verify page in one call. */
export function validateVerifyParams(params: {
  returnUrl: string | null;
  claim: string | null;
  thresholdYears: string | null;
  threshold: string | null;
  restricted: string | null;
  currentOrigin?: string;
}): {
  returnUrlError: string | null;
  claimError: string | null;
  thresholdYearsError: string | null;
  thresholdError: string | null;
  restrictedError: string | null;
  hasErrors: boolean;
} {
  const returnUrlResult = validateReturnUrl(
    params.returnUrl ?? "",
    params.currentOrigin
  );

  const claimError =
    params.claim && !(VALID_CLAIM_TYPES as readonly string[]).includes(params.claim)
      ? `Unknown credential type "${params.claim}". Supported: ${VALID_CLAIM_TYPES.join(", ")}.`
      : null;

  const tyResult = validateNumericParam(params.thresholdYears, {
    name: "threshold_years",
    min: 1,
    max: 150,
  });

  const tResult = validateNumericParam(params.threshold, {
    name: "threshold",
    min: 1,
  });

  const rResult = validateRestrictedList(params.restricted);

  const returnUrlError = returnUrlResult.ok ? null : returnUrlResult.error;
  const thresholdYearsError = tyResult.ok ? null : (tyResult as { ok: false; error: string }).error;
  const thresholdError = tResult.ok ? null : (tResult as { ok: false; error: string }).error;
  const restrictedError = rResult.ok ? null : rResult.error;

  return {
    returnUrlError,
    claimError,
    thresholdYearsError,
    thresholdError,
    restrictedError,
    hasErrors: !!(returnUrlError ?? claimError ?? thresholdYearsError ?? thresholdError ?? restrictedError),
  };
}
