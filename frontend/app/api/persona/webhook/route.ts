import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { IssuerClient, type CredentialType } from "@stellarcred/issuer";
import { fetchIssuerPubkey } from "@/lib/issuer-registry";
import { logger, stripSensitiveFields } from "@/lib/logger";
import { storePersonaResult } from "@/lib/persona-cache";
import {
  verifyPersonaWebhookSignature,
  parsePersonaWebhookEvent,
  extractKycAttributes,
} from "@/lib/persona";

export const dynamic = "force-dynamic";

// Same fallback key as app/api/issue/route.ts — must sign with the same key
// so credentials issued here verify against the same registered issuer
// pubkey as the synchronous (mock) path.
const DEMO_SK_HEX =
  process.env.ISSUER_PRIVATE_KEY ||
  Buffer.from(sha256(new TextEncoder().encode("stellarcred-demo-issuer"))).toString("hex");

const issuer = new IssuerClient({ privateKey: DEMO_SK_HEX });
const SIM_ACCOUNT =
  process.env.NEXT_PUBLIC_ISSUER_ADDRESS ??
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function localIssuerPubkeyBytes(): Buffer {
  const { x, y } = issuer.publicKey();
  return Buffer.from([...x, ...y]);
}

const COMPLETION_EVENTS = new Set(["inquiry.completed", "inquiry.approved"]);

// Credential types Persona's KYC template can actually supply attributes
// for. "funds" is gated on a live Plaid balance, not anything in this
// payload — skip it rather than issue it unverified if it's ever requested
// alongside kyc.
const PERSONA_ISSUABLE_TYPES = new Set(["kyc", "age", "jurisdiction", "income", "accreditation"]);

export async function POST(req: NextRequest) {
  const requestId = randomBytes(16).toString("hex");
  // Signature verification needs the exact bytes Persona signed — read the
  // raw body text, never req.json() (which would require re-serializing).
  const rawBody = await req.text();

  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    logger.error(stripSensitiveFields({ event: "webhook_misconfigured", requestId }));
    return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });
  }

  const signatureHeader = req.headers.get("persona-signature");
  if (!verifyPersonaWebhookSignature(rawBody, signatureHeader, secret)) {
    logger.warn(stripSensitiveFields({ event: "webhook_signature_invalid", requestId }));
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const parsed = parsePersonaWebhookEvent(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }
  const { eventName, inquiryId, status, fields, reference } = parsed;

  logger.info(stripSensitiveFields({
    event: "webhook_received",
    inquiryId,
    outcome: eventName,
    requestId,
  }));

  // Ack anything we don't act on (other event types, non-approved statuses,
  // or an inquiry we didn't create the reference for) so Persona doesn't
  // keep retrying delivery.
  if (!COMPLETION_EVENTS.has(eventName) || status !== "approved" || !reference) {
    return NextResponse.json({ received: true });
  }

  if (process.env.NEXT_PUBLIC_ISSUER_REGISTRY_ID) {
    const registered = await fetchIssuerPubkey(reference.issuerId, SIM_ACCOUNT);
    const localKey = localIssuerPubkeyBytes();
    if (!registered || !Buffer.from(registered).equals(localKey)) {
      logger.error(stripSensitiveFields({
        event: "webhook_issuer_mismatch",
        inquiryId,
        issuerId: reference.issuerId,
        requestId,
      }));
      return NextResponse.json({ received: true });
    }
  }

  // Only the derived numeric attributes cross this boundary — raw Persona
  // fields (name, government ID number, address, selfie, ...) are discarded
  // the instant extractKycAttributes returns and are never logged or stored.
  const { dob, countryNumeric } = extractKycAttributes(fields);
  const attributes: Record<string, string> = { ...reference.attributes };
  if (dob) attributes.date_of_birth = dob;
  if (countryNumeric) attributes.country_code = countryNumeric;

  const issuableTypes = Array.from(new Set(reference.credentialTypes)).filter((t) =>
    PERSONA_ISSUABLE_TYPES.has(t),
  );

  try {
    const credentials = [];
    for (const type of issuableTypes) {
      logger.info(stripSensitiveFields({
        event: "signing_started",
        credentialType: type,
        issuerId: reference.issuerId,
        walletAddress: reference.holder,
        requestId,
      }));
      const credential = await issuer.issue({
        type: type as CredentialType,
        holder: reference.holder,
        issuerId: reference.issuerId,
        issuerName: reference.issuerName,
        expiry: reference.expiry,
        attribute: attributes,
        claimParams: reference.claimParams,
      });
      credentials.push(credential);
    }
    storePersonaResult(inquiryId, credentials);
    logger.info(stripSensitiveFields({
      event: "webhook_issued",
      inquiryId,
      issuerId: reference.issuerId,
      walletAddress: reference.holder,
      outcome: "success",
      requestId,
    }));
  } catch (e) {
    logger.error(stripSensitiveFields({
      event: "webhook_issue_failed",
      inquiryId,
      issuerId: reference.issuerId,
      walletAddress: reference.holder,
      error: (e as Error).message,
      requestId,
    }));
  }

  return NextResponse.json({ received: true });
}
