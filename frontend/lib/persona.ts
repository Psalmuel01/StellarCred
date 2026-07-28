// Server-side Persona (KYC provider) integration shared between the
// synchronous demo path (app/api/issue) and the asynchronous production path
// (app/api/persona/webhook + app/api/persona/result). Everything here reads
// PERSONA_API_KEY / PERSONA_WEBHOOK_SECRET, which must stay server-only —
// never import this from a client component.
import { createHmac, timingSafeEqual } from "crypto";
import type { ClaimParams } from "@stellarcred/issuer";

const PERSONA_BASE = "https://withpersona.com/api/v1";
const PERSONA_VERSION = "2023-01-05";

function personaHeaders() {
  return {
    Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
    "Content-Type": "application/json",
    "Persona-Version": PERSONA_VERSION,
  };
}

// Everything the webhook needs to finish issuing a credential once Persona
// approves the inquiry. Round-tripped through Persona as the inquiry's
// reference-id and echoed back on the webhook payload — we don't keep our
// own record of pending requests, since the callback may land on a
// different server instance than the one that created the inquiry.
export interface PersonaReference {
  holder: string;
  issuerId: string;
  issuerName: string;
  expiry: string;
  credentialTypes: string[];
  attributes: Record<string, string>;
  claimParams?: ClaimParams;
}

export async function createPersonaInquiry(
  templateId: string,
  redirectUri: string,
  reference: PersonaReference,
): Promise<{ url: string; id: string }> {
  const res = await fetch(`${PERSONA_BASE}/inquiries`, {
    method: "POST",
    headers: personaHeaders(),
    body: JSON.stringify({
      data: {
        attributes: {
          "inquiry-template-id": templateId,
          "redirect-uri": redirectUri,
          "reference-id": JSON.stringify(reference),
        },
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Persona: failed to create inquiry — ${JSON.stringify(json)}`);
  const id: string = json.data.id;
  // Persona hosted flow URL
  const url = `https://withpersona.com/verify?inquiry-id=${id}`;
  return { url, id };
}

// Minimal ISO 3166-1 alpha-2 → numeric map for countries we care about.
// Persona returns alpha-2 codes; our jurisdiction circuit uses numeric.
const ALPHA2_TO_NUMERIC: Record<string, string> = {
  NG: "566", US: "840", DE: "276", IN: "356", IR: "364",
  GB: "826", FR: "250", CA: "124", AU: "036", BR: "076",
  CN: "156", JP: "392", KR: "410", ZA: "710", GH: "288",
  KE: "404", EG: "818", MX: "484", AR: "032", SG: "702",
};

function alpha2ToNumeric(code: string): string {
  return ALPHA2_TO_NUMERIC[code.toUpperCase()] ?? "0";
}

// Pulls only the two fields StellarCred's circuits need — birthdate (for the
// age claim) and country (for jurisdiction) — out of a Persona inquiry's
// `fields`. Everything else Persona returns (name, government ID number,
// selfie, address, ...) is ignored here and never touches the rest of the app.
export function extractKycAttributes(
  fields: Record<string, { value: unknown } | undefined>,
): { dob?: string; countryNumeric?: string } {
  const dob =
    String(fields["birthdate"]?.value ?? fields["birth-date"]?.value ?? "").trim() || undefined;
  const alpha2 =
    String(
      fields["selected-country-code"]?.value ??
        fields["country-code"]?.value ??
        fields["address-country-code"]?.value ??
        "",
    ).trim() || undefined;
  return { dob, countryNumeric: alpha2 ? alpha2ToNumeric(alpha2) : undefined };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------
// Persona signs webhooks with a `Persona-Signature` header shaped like
// `t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]`. The signed message is
// `${t}.${rawBody}`, HMAC-SHA256 with the webhook secret, hex-encoded.
// Multiple v1 values appear during secret rotation — any match is accepted.
// Callers must pass the raw request body text, not a JSON.parse/stringify
// round trip, since re-serialization is not guaranteed byte-identical.
export function verifyPersonaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && !timestamp) timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const expectedHex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expected = Buffer.from(expectedHex, "hex");

  return signatures.some((sig) => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false;
    const actual = Buffer.from(sig, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export interface PersonaWebhookEvent {
  eventName: string;
  inquiryId: string;
  status: string;
  fields: Record<string, { value: unknown } | undefined>;
  reference: PersonaReference | null;
}

function isPersonaReference(value: unknown): value is PersonaReference {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.holder === "string" &&
    typeof v.issuerId === "string" &&
    typeof v.issuerName === "string" &&
    Array.isArray(v.credentialTypes)
  );
}

// Parses a Persona webhook body (JSON:API event envelope wrapping an inquiry
// resource under data.attributes.payload.data). Returns null if the payload
// isn't a recognizable inquiry event.
export function parsePersonaWebhookEvent(rawBody: string): PersonaWebhookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const data = (json as { data?: unknown })?.data as Record<string, unknown> | undefined;
  const attrs = data?.attributes as Record<string, unknown> | undefined;
  const eventName = attrs?.name;
  const inquiry = (attrs?.payload as { data?: Record<string, unknown> } | undefined)?.data;
  if (typeof eventName !== "string" || !inquiry || inquiry.type !== "inquiry") return null;

  const inquiryAttrs = (inquiry.attributes ?? {}) as Record<string, unknown>;
  let reference: PersonaReference | null = null;
  const refRaw = inquiryAttrs["reference-id"];
  if (typeof refRaw === "string") {
    try {
      const parsedRef = JSON.parse(refRaw);
      if (isPersonaReference(parsedRef)) reference = parsedRef;
    } catch {
      reference = null;
    }
  }

  return {
    eventName,
    inquiryId: String(inquiry.id ?? ""),
    status: String(inquiryAttrs.status ?? ""),
    fields: (inquiryAttrs.fields ?? {}) as Record<string, { value: unknown } | undefined>,
    reference,
  };
}
