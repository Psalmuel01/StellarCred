// Validation for the /verify page's incoming link parameters (return_url,
// claim, threshold params, restricted list, Persona inquiry-id).
//
// The verify page is reached two ways:
//   1. Self-service: a plain "/verify" visit (sidebar, homepage CTAs, "Get a
//      credential"). No verification-link params → the normal flow runs with no
//      claim lock and no protocol redirect.
//   2. Protocol verification link: "/verify?return_url=…&claim=…&threshold=…"
//      built by @stellarcred/sdk `buildVerifyUrl` (or any protocol app). These
//      params must all be well-formed. If any are malformed we return a
//      specific VerifyError so the page can render a clear "this verification
//      link is invalid" screen instead of a blank page, a stuck spinner, or a
//      silent proceed.
//
// This module is pure (no DOM / network) so it is easy to unit test, which the
// verify page and its tests rely on.

import { CREDENTIAL_TYPES, type CredentialType } from "./stellar";
import type { ClaimParams } from "./credential";

/** The distinct reasons a verification link can be invalid. */
export type VerifyErrorCode =
  | "missing_return_url"
  | "bad_claim"
  | "bad_threshold"
  | "bad_restricted"
  | "bad_return_url";

export interface VerifyError {
  code: VerifyErrorCode;
  /** Short heading shown at the top of the error panel. */
  title: string;
  /** Human-friendly explanation of exactly what is wrong. */
  detail: string;
}

export interface ParsedVerifyParams {
  ok: boolean;
  /**
   * True when the link intends to be a protocol verification link (i.e. it
   * carried any verification params). When false this is a self-service visit
   * that keeps the current behaviour.
   */
  isVerificationLink: boolean;
  /** Validated, open-redirect-free return URL (https, or site-relative). */
  returnUrl?: string;
  /** Validated claim type, or null when absent / not a protocol link. */
  requiredClaim?: CredentialType | null;
  /** Normalised proof parameters to carry into the issued credential. */
  claimParams?: ClaimParams;
  /** Persona resume id, when present. */
  inquiryId?: string;
  /** When ok is false, describes why the link is invalid. */
  error?: VerifyError;
}

/** Claim types that carry a numeric threshold in their proof params. */
const THRESHOLD_CLAIMS: CredentialType[] = ["age", "income", "funds", "accreditation"];

const VALID_CLAIM_SET = new Set<string>(CREDENTIAL_TYPES);

function isCredentialType(value: string | undefined): value is CredentialType {
  return value !== undefined && VALID_CLAIM_SET.has(value);
}

/** A non-negative integer, matching how the circuits consume thresholds. */
function isNonNegativeInteger(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value);
}

/**
 * Validate a return URL. Accepts https URLs and site-relative paths only
 * (never http, javascript:, or a fully-qualified non-https URL).
 */
export function isValidReturnUrl(returnUrl: string): boolean {
  if (returnUrl.startsWith("/")) return true;
  try {
    const parsed = new URL(returnUrl);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse and validate the /verify query string. Returns either a usable result
 * or a specific VerifyError describing what makes the link invalid.
 */
export function parseVerifyParams(search: {
  return_url?: string | null;
  claim?: string | null;
  threshold_years?: string | null;
  threshold?: string | null;
  min_threshold?: string | null;
  restricted?: string | null;
  inquiry_id?: string | null;
}): ParsedVerifyParams {
  // Coerce all raw search params to string | undefined once, so the rest of
  // the function only deals with a single nullable flavour.
  const return_url = search.return_url ?? undefined;
  const inquiry_id = search.inquiry_id ?? undefined;
  const claim = search.claim ?? undefined;
  const threshold_years = search.threshold_years ?? undefined;
  const threshold = search.threshold ?? undefined;
  const min_threshold = search.min_threshold ?? undefined;
  const restricted = search.restricted ?? undefined;

  // A verification link is identifiable by carrying at least one verification
  // parameter. A plain /verify visit, or a Persona resume (?inquiry-id=…), has
  // none and is treated as self-service.
  const hasVerificationParams = [
    return_url,
    claim,
    threshold_years,
    threshold,
    min_threshold,
    restricted,
  ].some((v) => v !== undefined && v !== "");

  // Self-service / Persona resume: not a protocol link, nothing to validate.
  if (!hasVerificationParams) {
    return {
      ok: true,
      isVerificationLink: false,
      requiredClaim: null,
      inquiryId: inquiry_id,
    };
  }

  // ── Verification link — a return_url is mandatory for a protocol to get the
  // user back. Missing it means the link was truncated / malformed.
  if (!return_url) {
    return {
      ok: false,
      isVerificationLink: true,
      requiredClaim: null,
      inquiryId: inquiry_id,
      error: {
        code: "missing_return_url",
        title: "This verification link is missing its return URL",
        detail:
          "A valid verification link must say where to bring you back after you verify. Ask the service that sent you here for a fresh link.",
      },
    };
  }

  if (!isValidReturnUrl(return_url)) {
    return {
      ok: false,
      isVerificationLink: true,
      requiredClaim: null,
      inquiryId: inquiry_id,
      error: {
        code: "bad_return_url",
        title: "This verification link has an invalid return URL",
        detail:
          "The return URL must be a secure (https) web address or a path on this site. It may have been truncated or corrupted.",
      },
    };
  }

  // ── claim type must be one we actually support.
  if (claim !== undefined && !isCredentialType(claim)) {
    return {
      ok: false,
      isVerificationLink: true,
      requiredClaim: null,
      inquiryId: inquiry_id,
      error: {
        code: "bad_claim",
        title: "\u201c" + claim + "\u201d is not a credential we support",
        detail:
          "The link asked for an unrecognised credential type. Supported types are: " +
          CREDENTIAL_TYPES.join(", ") +
          ". Try a fresh verification link from the service.",
      },
    };
  }

  // ── Threshold params must be non-negative integers where applicable.
  const isThresholdClaim = claim !== undefined && THRESHOLD_CLAIMS.includes(claim);
  const primaryThreshold =
    claim === "age" ? (threshold_years ?? min_threshold) : (threshold ?? min_threshold);
  if (isThresholdClaim && primaryThreshold !== undefined && !isNonNegativeInteger(primaryThreshold)) {
    return {
      ok: false,
      isVerificationLink: true,
      requiredClaim: null,
      inquiryId: inquiry_id,
      error: {
        code: "bad_threshold",
        title: "This claim threshold is invalid",
        detail:
          "The " +
          claim +
          " gate expects a whole-number threshold (for example \u201c21\u201d or \u201c50000\u201d), but got \u201c" +
          primaryThreshold +
          "\u201d. The link may be malformed.",
      },
    };
  }

  // ── restricted list must be numeric country codes.
  if (restricted !== undefined && restricted !== "") {
    const codes = restricted.split(",").map((s) => s.trim());
    if (codes.some((c) => !/^\d{1,4}$/.test(c))) {
      return {
        ok: false,
        isVerificationLink: true,
        requiredClaim: null,
        inquiryId: inquiry_id,
        error: {
          code: "bad_restricted",
          title: "The restricted-countries list is malformed",
          detail:
            "The restricted parameter should be numeric country codes separated by commas (for example \u201c840,364\u201d).",
        },
      };
    }
  }

  // Normalise claimParams so only fields that apply to the requested claim are
  // carried through (unused fields are omitted entirely).
  const cleanClaimParams: ClaimParams = {};
  if (claim === "age") {
    if (primaryThreshold !== undefined) cleanClaimParams.threshold_years = primaryThreshold;
  } else if (claim !== undefined && THRESHOLD_CLAIMS.includes(claim)) {
    if (primaryThreshold !== undefined) cleanClaimParams.threshold = primaryThreshold;
  }
  if (claim !== undefined && claim === "jurisdiction" && restricted) {
    const restrictedCodes = restricted.split(",").map((s) => s.trim()).filter(Boolean);
    if (restrictedCodes.length > 0) cleanClaimParams.restricted = restrictedCodes.sort();
  }

  return {
    ok: true,
    isVerificationLink: true,
    returnUrl: return_url,
    requiredClaim: (claim as CredentialType) ?? null,
    claimParams: cleanClaimParams,
    inquiryId: inquiry_id,
  };
}