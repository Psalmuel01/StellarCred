import { z } from "zod";

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export const credentialTypeSchema = z.enum(["kyc", "age", "income", "jurisdiction", "funds"]);

export const issueRequestSchema = z.object({
  wallet: z.string().trim().regex(STELLAR_ADDRESS_REGEX, "wallet must be a valid Stellar address"),
  credentialType: credentialTypeSchema,
  attributes: z.record(z.string(), z.string()).default({}),
});

const claimParamsSchema = z.object({
  threshold_years: z.string().optional(),
  threshold: z.string().optional(),
  restricted: z.array(z.string()).optional(),
});

export const legacyIssueRequestSchema = z.object({
  credential_types: z.array(credentialTypeSchema).optional(),
  type: credentialTypeSchema.optional(),
  holder: z.string().optional(),
  issuerId: z.string().optional(),
  issuerName: z.string().optional(),
  expiry: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  attribute: z.string().optional(),
  claimParams: claimParamsSchema.optional(),
  persona_inquiry_id: z.string().optional(),
  returnUrl: z.string().optional(),
}).passthrough();

export const witnessRequestSchema = z.object({
  type: z.string().trim().min(1, "type is required"),
  credential: z.record(z.string(), z.unknown()),
});

export type IssueRequest = z.infer<typeof issueRequestSchema>;

export interface NormalizedIssueRouteBody {
  wallet: string;
  credentialType: string;
  attributes: Record<string, string>;
  credentialTypes: string[];
  issuerId?: string;
  issuerName?: string;
  expiry?: string;
  claimParams?: z.infer<typeof claimParamsSchema>;
  personaInquiryId?: string;
  returnUrl?: string;
}

export class ValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(details.join("; "));
    this.name = "ValidationError";
  }
}

export function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    });
    throw new ValidationError(issues);
  }
  return result.data;
}

export function normalizeIssueRouteBody(body: unknown): NormalizedIssueRouteBody {
  const direct = issueRequestSchema.safeParse(body);
  if (direct.success) {
    return {
      wallet: direct.data.wallet,
      credentialType: direct.data.credentialType,
      attributes: direct.data.attributes,
      credentialTypes: [direct.data.credentialType],
    };
  }

  const legacy = legacyIssueRequestSchema.safeParse(body);
  if (legacy.success) {
    const data = legacy.data;
    const credentialTypes = data.credential_types ?? (data.type ? [data.type] : []);
    const attributes: Record<string, string> = { ...(data.attributes ?? {}) };

    if (data.attribute !== undefined && data.type) {
      if (data.type === "age") attributes.date_of_birth ??= data.attribute;
      else if (data.type === "income") attributes.income ??= data.attribute;
      else if (data.type === "jurisdiction") attributes.country_code ??= data.attribute;
    }

    return {
      wallet: data.holder ?? "",
      credentialType: data.type ?? credentialTypes[0] ?? "",
      attributes,
      credentialTypes,
      issuerId: data.issuerId,
      issuerName: data.issuerName,
      expiry: data.expiry,
      claimParams: data.claimParams,
      personaInquiryId: data.persona_inquiry_id,
      returnUrl: data.returnUrl,
    };
  }

  const issues = [
    ...direct.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
    ...legacy.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
  ];
  throw new ValidationError(issues);
}
