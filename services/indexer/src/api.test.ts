import { describe, it, expect } from "vitest";
import { normalizeClaimRow, ClaimResponse } from "./api";

describe("Indexer API Response Schema Validation", () => {
  it("normalizes raw SQLite integer/boolean DB rows into strict schema", () => {
    const rawSqliteRow = {
      id: "claim_123",
      issuer: "G123...",
      holder: "G456...",
      claim_type: "credit_score",
      verified_at: 1700000000,
      expiry: 1800000000,
      revoked: 0,
      internal_db_col: "secret",
    };

    const normalized: ClaimResponse = normalizeClaimRow(rawSqliteRow);

    expect(normalized).toEqual({
      id: "claim_123",
      issuer: "G123...",
      holder: "G456...",
      claim_type: "credit_score",
      verified_at: 1700000000,
      expiry: 1800000000,
      revoked: false,
    });
    expect(normalized).not.toHaveProperty("internal_db_col");
    expect(typeof normalized.verified_at).toBe("number");
    expect(typeof normalized.revoked).toBe("boolean");
  });

  it("normalizes Postgres bigint-as-string and truthy values cleanly", () => {
    const rawPostgresRow = {
      id: "claim_456",
      issuer: "G123...",
      holder: "G789...",
      claim_type: "verification",
      verified_at: "1700000000",
      expiry: null,
      revoked: "1",
    };

    const normalized = normalizeClaimRow(rawPostgresRow);

    expect(normalized).toEqual({
      id: "claim_456",
      issuer: "G123...",
      holder: "G789...",
      claim_type: "verification",
      verified_at: 1700000000,
      expiry: null,
      revoked: true,
    });
    expect(typeof normalized.verified_at).toBe("number");
    expect(typeof normalized.revoked).toBe("boolean");
  });
});
