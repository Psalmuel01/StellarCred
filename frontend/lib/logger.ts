import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level: LOG_LEVEL,
});


// Correlates one issuance across /api/issue -> /api/witness -> /api/plaid-balance
// (and any Persona relay round-trip) so every log line for a single request can
// be grepped by requestId.
// Note: resolveRequestId is now defined in middleware.ts to avoid crypto module
// imports in edge runtime

// Explicit allowlist of fields that are safe to log
const SAFE_FIELDS = [
  "event",
  "credentialType",
  "issuerId",
  "walletAddress",
  "outcome",
  "durationMs",
  "requestId",
  "level",
  "time",
  "pid",
  "hostname",
  "error",
  "needsPersona",
  "method",
  "path",
  "status",
  "demoIssuer",
  "plaidMock",
  "personaDemo",
  "environment",
  "timestamp",
  "auditIndex",
  "auditHash",
];

export function stripSensitiveFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (SAFE_FIELDS.includes(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}
