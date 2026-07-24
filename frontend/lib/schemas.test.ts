import { describe, expect, it } from "vitest";
import { issueRequestSchema, validate } from "./schemas";

describe("issue request validation", () => {
  it("rejects a missing wallet field", () => {
    expect(() => validate(issueRequestSchema, { credentialType: "kyc", attributes: {} })).toThrowError(/wallet/i);
  });

  it("rejects a wrong field type", () => {
    expect(() => validate(issueRequestSchema, {
      wallet: 123,
      credentialType: "kyc",
      attributes: {},
    })).toThrowError(/wallet/i);
  });

  it("rejects an invalid wallet address", () => {
    expect(() => validate(issueRequestSchema, {
      wallet: "not-a-stellar-address",
      credentialType: "kyc",
      attributes: {},
    })).toThrowError(/wallet/i);
  });

  it("accepts a valid payload and returns typed data", () => {
    const data = validate(issueRequestSchema, {
      wallet: `G${"A".repeat(55)}`,
      credentialType: "kyc",
      attributes: { foo: "bar" },
    });

    expect(data.wallet).toBe(`G${"A".repeat(55)}`);
    expect(data.credentialType).toBe("kyc");
    expect(data.attributes).toEqual({ foo: "bar" });
  });
});
