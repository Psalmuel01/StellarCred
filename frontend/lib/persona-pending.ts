// Pending-issuance state stashed across the Persona redirect round-trip.
//
// Security model (see docs/THREAT_MODEL.md): identity attributes must not be
// persisted after the KYC provider call. The blob written here survives the
// user's visit to Persona's hosted flow, so it may contain ONLY what is
// needed to resume issuance — credential types, holder wallet, issuer
// linkage, expiry, and non-PII claim parameters (thresholds etc.). Identity
// values (DOB, country, names, ID numbers) are re-derived server-side from
// Persona on resume (app/api/issue/route.ts), never carried through here.

export const PERSONA_PENDING_KEY = "sc_persona_pending";

/**
 * Keys that must never appear anywhere inside the serialized blob — neither
 * top-level nor nested. `attributes` is banned wholesale: every value it can
 * carry (date_of_birth, income, net_worth, country_code, seniority,
 * balance) is an identity attribute.
 */
export const PII_KEYS = [
  "attributes",
  "attribute",
  "first_name",
  "last_name",
  "id_number",
  "date_of_birth",
  "birthdate",
  "country_code",
  "income",
  "net_worth",
  "seniority",
  "balance",
] as const;

/** Exactly what resuming issuance needs — and nothing more. */
export interface PersonaPendingPayload {
  credential_types: string[];
  holder: string;
  issuerId: string;
  issuerName?: string;
  expiry?: string;
  /** Thresholds/modes from protocol query params. Non-PII by construction. */
  claimParams?: Record<string, unknown>;
}

/**
 * Recursively remove any banned key from an arbitrary value. Protocol
 * claimParams arrive from URL query strings, so they can carry unexpected
 * keys — anything matching a banned key is dropped rather than persisted.
 */
function stripPii(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((PII_KEYS as readonly string[]).includes(key)) continue;
    out[key] = stripPii(child);
  }
  return out;
}

/**
 * Serialize a PII-free resume payload into sessionStorage. Unknown extra keys
 * are stripped so future payload fields can't leak in unnoticed, and banned
 * keys are removed at every depth before anything touches storage.
 */
export function savePersonaPending(payload: PersonaPendingPayload): void {
  // Whitelist: only known resume-relevant fields survive serialization.
  const sanitized = stripPii({
    credential_types: payload.credential_types,
    holder: payload.holder,
    issuerId: payload.issuerId,
    ...(payload.issuerName ? { issuerName: payload.issuerName } : {}),
    ...(payload.expiry ? { expiry: payload.expiry } : {}),
    ...(payload.claimParams ? { claimParams: payload.claimParams } : {}),
  }) as PersonaPendingPayload;
  try {
    sessionStorage.setItem(PERSONA_PENDING_KEY, JSON.stringify(sanitized));
  } catch {
    // storage unavailable (private mode / blocked) — the Persona redirect
    // will still proceed; resume issuance will simply find no pending payload
  }
}

/**
 * Read and immediately clear the pending payload. Clearing on read is what
 * guarantees cleanup on both success and failure of the resumed issue call;
 * a payload that is never read (user abandons after returning) is cleared by
 * the page's mount-time sweep via clearStalePersonaPending().
 */
export function loadPersonaPending(): PersonaPendingPayload | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PERSONA_PENDING_KEY);
    sessionStorage.removeItem(PERSONA_PENDING_KEY);
  } catch {
    // storage unavailable (private mode / blocked) — treat as no pending payload
    return null;
  }
  if (!raw) return null;
  try {
    // Defensively re-strip in case an older build stored something that is
    // now considered sensitive; drop the blob entirely if it's corrupt.
    return stripPii(JSON.parse(raw)) as PersonaPendingPayload;
  } catch {
    return null;
  }
}

export function clearPersonaPending(): void {
  try {
    sessionStorage.removeItem(PERSONA_PENDING_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

/**
 * Called on every /verify mount: if the user came back from Persona without
 * an inquiry-id (abandoned flow), any lingering blob is wiped immediately.
 */
export function clearStalePersonaPending(hasInquiryId: boolean): void {
  if (!hasInquiryId) clearPersonaPending();
}
