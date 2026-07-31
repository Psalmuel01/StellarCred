import { NextRequest, NextResponse } from "next/server";
import type { InputMap } from "@noir-lang/noir_js";
import { logger, stripSensitiveFields, resolveRequestId } from "../../../lib/logger";
import { readJsonBody, bodyErrorResponse } from "../../../lib/request-limits";
import {
  normalizeRestricted,
  validateWitnessCredential,
  type ClaimParams,
} from "../../../lib/witness-input";
import ageCircuit from "../../../public/circuits/age.json";
import fundsCircuit from "../../../public/circuits/funds.json";
import incomeCircuit from "../../../public/circuits/income.json";
import jurisdictionCircuit from "../../../public/circuits/jurisdiction.json";
import kycCircuit from "../../../public/circuits/kyc.json";
import accreditationCircuit from "../../../public/circuits/accreditation.json";
import employmentCircuit from "../../../public/circuits/employment.json";

// Default claim params -- used when a credential has no protocol-specific values.
const DEFAULT_THRESHOLD_YEARS = "18";
const DEFAULT_INCOME_THRESHOLD = "200000";
const DEFAULT_FUNDS_THRESHOLD = "10000";
const DEFAULT_ACCREDITATION_THRESHOLD = "1000000";
// Padded to RESTRICTED_LEN by the same helper the request path uses.
const DEFAULT_RESTRICTED = normalizeRestricted(["840", "364", "408"]);

// Validation accepts a threshold as a number as well as a decimal string; the
// circuits take field elements as strings, so normalize on the way in.
const asFieldString = (v: string | number | undefined, fallback: string): string =>
  v === undefined ? fallback : String(v);

function buildInputs(type: string, cred: Record<string, unknown>): InputMap {
  const value = String(cred.value);
  const salt = String(cred.salt);
  const commitment = String(cred.commitment);
  const params = (cred.claimParams ?? {}) as ClaimParams;
  const sigInputs = {
    sig: cred.sig as number[],
    issuer_x: cred.issuerPubX as number[],
    issuer_y: cred.issuerPubY as number[],
  };
  switch (type) {
    case "age":
      return {
        date_of_birth: value,
        salt,
        ...sigInputs,
        commitment,
        current_date: String(Math.floor(Date.now() / 86_400_000)),
        threshold_years: asFieldString(params.threshold_years, DEFAULT_THRESHOLD_YEARS),
      };
    case "income":
      return {
        income: value,
        salt,
        ...sigInputs,
        commitment,
        threshold: asFieldString(params.threshold, DEFAULT_INCOME_THRESHOLD),
      };
    case "jurisdiction":
      return {
        country_code: value,
        salt,
        ...sigInputs,
        commitment,
        restricted: normalizeRestricted(
          params.restricted ?? DEFAULT_RESTRICTED,
        ),
      };
    case "funds":
      return {
        balance: value,
        salt,
        ...sigInputs,
        commitment,
        threshold: asFieldString(params.threshold, DEFAULT_FUNDS_THRESHOLD),
      };
    case "accreditation":
      return {
        net_worth: value,
        salt,
        ...sigInputs,
        commitment,
        threshold: asFieldString(params.threshold, DEFAULT_ACCREDITATION_THRESHOLD),
      };
    case "employment":
      return {
        // employment_status is the binary "is employed" tag; seniority is the
        // specific tenure the issuer committed to. Both must come from the
        // stored credential (issuer-signed) -- NOT from request params -- so the
        // holder can't claim a seniority they weren't actually issued.
        employment_status: value,
        seniority: String(cred.seniority ?? "0"),
        salt,
        ...sigInputs,
        commitment,
        min_seniority: params.threshold ?? String(cred.seniority ?? "3"),
      };
    case "kyc":
    default:
      return { secret: value, salt, ...sigInputs, commitment };
  }
}

function circuitFor(type: string) {
  switch (type) {
    case "age":
      return ageCircuit;
    case "funds":
      return fundsCircuit;
    case "accreditation":
      return accreditationCircuit;
    case "income":
      return incomeCircuit;
    case "jurisdiction":
      return jurisdictionCircuit;
    case "employment":
      return employmentCircuit;
    case "kyc":
    default:
      return kycCircuit;
  }
}

// ── Input validation ─────────────────────────────────────────────────────────
//
// Validated before buildInputs so malformed requests fail with a precise 400
// instead of triggering an opaque circuit-execution crash. No PII, secret
// material, or key bytes are echoed in error messages — only field names and
// structural facts (expected vs. received lengths / type names).

type ValidationResult = { valid: true } | { valid: false; error: string; field: string };

// Returns true iff `v` is an array of integers in [0, 255].
function isByteArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((b) => typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

// Matches the Noir field strings the issuer pipeline produces: a decimal
// integer or a 0x-prefixed hex string, optionally negative. We do NOT bound the
// value to the BN254 scalar field here — that is the circuit's job — we only
// reject obvious garbage (empty strings, non-numeric text, fractions).
function isFieldString(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  const s = v.trim();
  // 0x-hex (optionally signed) — only hex digits after the prefix.
  if (/^-?0x[0-9a-fA-F]+$/i.test(s)) return true;
  // Decimal integer (optionally signed) — reject fractions / exponents.
  return /^-?\d+$/.test(s);
}

// A non-empty string that parses as a finite integer. Used for threshold fields
// (threshold_years, threshold) which the circuits consume as integers.
function isNonNegIntString(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0;
}

function validateByteField(cred: Record<string, unknown>, key: string, expected: number): ValidationResult {
  const v = cred[key];
  if (!Array.isArray(v)) {
    return { valid: false, field: key, error: `${key} must be an array of bytes` };
  }
  if (v.length !== expected) {
    return { valid: false, field: key, error: `${key} must be exactly ${expected} bytes, got ${v.length}` };
  }
  if (!isByteArray(v)) {
    return { valid: false, field: key, error: `${key} must contain only integers in [0, 255]` };
  }
  return { valid: true };
}

function validateRequiredField(cred: Record<string, unknown>, key: string): ValidationResult {
  if (cred[key] === undefined || cred[key] === null) {
    return { valid: false, field: key, error: `${key} is required` };
  }
  return { valid: true };
}

function validateFieldString(cred: Record<string, unknown>, key: string): ValidationResult {
  const presence = validateRequiredField(cred, key);
  if (!presence.valid) return presence;
  if (!isFieldString(cred[key])) {
    return { valid: false, field: key, error: `${key} must be a non-empty numeric or 0x-hex field string` };
  }
  return { valid: true };
}

function validateRestricted(list: unknown): ValidationResult {
  if (!Array.isArray(list)) {
    return { valid: false, field: "restricted", error: "restricted must be an array of ISO codes" };
  }
  // Each entry must be a numeric string (ISO 3166-1 numeric codes are digit
  // strings; padding sentinels are "0"). normalizeRestricted will pad/truncate
  // to RESTRICTED_LEN, so we only validate per-entry shape here.
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (typeof entry !== "string" || !/^\d+$/.test(entry)) {
      return {
        valid: false,
        field: `restricted[${i}]`,
        error: `restricted[${i}] must be a numeric ISO code string, got ${typeof entry}`,
      };
    }
  }
  return { valid: true };
}

function validateClaimParamsForType(type: string, params: ClaimParams): ValidationResult {
  // threshold_years only for age; threshold for income/funds/accreditation;
  // restricted for jurisdiction.
  if (type === "age") {
    const t = params.threshold_years;
    if (t !== undefined && !isNonNegIntString(t)) {
      return { valid: false, field: "threshold_years", error: "threshold_years must parse as a non-negative integer" };
    }
  } else if (type === "income" || type === "funds" || type === "accreditation") {
    const t = params.threshold;
    if (t !== undefined && !isNonNegIntString(t)) {
      return { valid: false, field: "threshold", error: "threshold must parse as a non-negative integer" };
    }
  } else if (type === "jurisdiction") {
    if (params.restricted !== undefined) {
      const r = validateRestricted(params.restricted);
      if (!r.valid) return r;
    }
  }
  return { valid: true };
}

/**
 * Validate a credential payload before it reaches the circuit. Returns
 * `{ valid: true }` on success or `{ valid: false, error, field }` describing
 * the first structural failure. Error messages contain only field names and
 * type/length facts — never values, secrets, or key material.
 */
export function validateCredential(
  cred: Record<string, unknown>,
  type: string,
): ValidationResult {
  // Core scalar fields — present and field-shaped.
  for (const key of ["value", "salt", "commitment"] as const) {
    const r = validateFieldString(cred, key);
    if (!r.valid) return r;
  }

  // Signature & issuer public key — fixed-length byte arrays.
  const sig = validateByteField(cred, "sig", 64);
  if (!sig.valid) return sig;
  const x = validateByteField(cred, "issuerPubX", 32);
  if (!x.valid) return x;
  const y = validateByteField(cred, "issuerPubY", 32);
  if (!y.valid) return y;

  // Protocol-specific claim params, if present.
  const params = (cred.claimParams ?? {}) as ClaimParams;
  const cp = validateClaimParamsForType(type, params);
  if (!cp.valid) return cp;

  return { valid: true };
}

export async function POST(req: NextRequest) {
  const requestId = resolveRequestId(req.headers.get("x-request-id"));

  const sendResponse = (response: NextResponse) => {
    response.headers.set("x-request-id", requestId);
    return response;
  };

  // Size-guarded read — an oversized payload is refused before it is parsed,
  // and the body is never logged.
  const parsed = await readJsonBody<{ type?: string; credential?: Record<string, unknown> }>(req);
  if (!parsed.ok) {
    logger.warn(stripSensitiveFields({
      event: "witness_request_rejected",
      outcome: parsed.error.code,
      requestId,
    }));
    return sendResponse(bodyErrorResponse(parsed.error));
  }

  const { type, credential } = parsed.body;
  if (!type || !credential) {
    return sendResponse(NextResponse.json(
      { error: "type and credential are required", code: "invalid_request" },
      { status: 400 },
    ));
  }

  logger.info(stripSensitiveFields({ event: "witness_request_received", credentialType: type, requestId }));

  // Circuit-shape validation before building the InputMap: a wrong-length
  // signature or a non-numeric field would otherwise fail deep inside Noir.
  const invalid = validateWitnessCredential(type, credential);
  if (invalid) {
    logger.warn(stripSensitiveFields({
      event: "witness_request_rejected",
      credentialType: type,
      outcome: "invalid_credential",
      requestId,
    }));
    return sendResponse(NextResponse.json(
      {
        error: `${invalid.field} ${invalid.message}`,
        code: "invalid_credential",
        field: invalid.field,
      },
      { status: 400 },
    ));
  }

  // Validate the credential payload BEFORE building the InputMap. Failures
  // return a structured 400 with the offending field name — no PII, secret
  // material, or key bytes in the message.
  const vr = validateCredential(credential, type);
  if (!vr.valid) {
    return NextResponse.json({ error: vr.error, field: vr.field }, { status: 400 });
  }

  try {
    const { Noir } = await import("@noir-lang/noir_js");
    const circuit = circuitFor(type);
    const noir = new Noir(circuit as never);
    const inputs = buildInputs(type, credential);
    const { witness } = await noir.execute(inputs);
    // Serialize Uint8Array → hex string for JSON transport.
    const hex = Buffer.from(witness).toString("hex");
    logger.info(stripSensitiveFields({
      event: "witness_response_sent",
      credentialType: type,
      outcome: "success",
      requestId,
    }));
    return sendResponse(NextResponse.json({ witness: hex }));
  } catch (e) {
    logger.error(stripSensitiveFields({
      event: "witness_response_sent",
      credentialType: type,
      outcome: "failure",
      error: (e as Error).message,
      requestId,
    }));
    return sendResponse(NextResponse.json({ error: (e as Error).message }, { status: 500 }));
  }
}
