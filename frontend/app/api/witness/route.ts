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
import aggregateCircuit from "../../../public/circuits/aggregate.json";

// Default claim params -- used when a credential has no protocol-specific values.
const DEFAULT_THRESHOLD_YEARS = "18";
const DEFAULT_INCOME_THRESHOLD = "200000";
const DEFAULT_FUNDS_THRESHOLD = "10000";
const DEFAULT_ACCREDITATION_THRESHOLD = "1000000";
// Padded to RESTRICTED_LEN by the same helper the request path uses.
const DEFAULT_RESTRICTED = normalizeRestricted(["840", "364", "408"]);
const RESTRICTED_LEN = 8;

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
        restricted: normalizeRestricted(params.restricted ?? DEFAULT_RESTRICTED),
        mode: params.mode ?? "0",
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
    case "aggregate":
      // The aggregate payload uses prefixed keys that mirror the circuit's
      // parameter names (see computeAggregateWitness in lib/proof.ts) rather
      // than the single-proof value/salt/commitment shape. Field elements
      // arrive as decimal strings; byte arrays pass through as-is. The current
      // date is derived server-side (like the single-proof age path) so a
      // caller can't game the age threshold with a client-chosen clock.
      return {
        kyc_secret: String(cred.kyc_secret),
        kyc_salt: String(cred.kyc_salt),
        kyc_sig: cred.kyc_sig as number[],
        kyc_commitment: String(cred.kyc_commitment),
        kyc_issuer_x: cred.kyc_issuer_x as number[],
        kyc_issuer_y: cred.kyc_issuer_y as number[],
        age_date_of_birth: String(cred.age_date_of_birth),
        age_salt: String(cred.age_salt),
        age_sig: cred.age_sig as number[],
        age_commitment: String(cred.age_commitment),
        age_issuer_x: cred.age_issuer_x as number[],
        age_issuer_y: cred.age_issuer_y as number[],
        age_current_date: String(Math.floor(Date.now() / 86_400_000)),
        age_threshold_years: String(cred.age_threshold_years),
        num_credentials: String(cred.num_credentials),
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
    case "aggregate":
      return aggregateCircuit;
    case "kyc":
    default:
      return kycCircuit;
  }
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
