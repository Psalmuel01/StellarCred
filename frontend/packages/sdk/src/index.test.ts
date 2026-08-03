import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isVerified = vi.fn();
const checkClaim = vi.fn();

vi.mock("../../proof-registry/src/index.js", () => ({
  Client: vi.fn(function ProofRegistryClient() {
    return {
      is_verified: isVerified,
      check_claim: checkClaim,
    };
  }),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {},
}));

import {
  configure,
  hasClaim,
  getClaims,
  ConfigError,
  RpcError,
  TimeoutError,
  StellarCred,
} from "./index";

const WALLET = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

describe("error taxonomy exports", () => {
  it("exports ConfigError, RpcError, and TimeoutError on the namespace", () => {
    expect(StellarCred.ConfigError).toBe(ConfigError);
    expect(StellarCred.RpcError).toBe(RpcError);
    expect(StellarCred.TimeoutError).toBe(TimeoutError);
    expect(new ConfigError().name).toBe("ConfigError");
    expect(new RpcError().name).toBe("RpcError");
  });
});

describe("hasClaim — fail-soft default", () => {
  beforeEach(() => {
    isVerified.mockReset();
    checkClaim.mockReset();
    configure({ registryId: "" });
  });

  it("returns false when registryId is missing (no throw)", async () => {
    await expect(hasClaim(WALLET, "kyc")).resolves.toBe(false);
    expect(isVerified).not.toHaveBeenCalled();
  });

  it("returns false when is_verified throws (network/simulation)", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockRejectedValue(new Error("network down"));
    await expect(hasClaim(WALLET, "kyc")).resolves.toBe(false);
  });

  it("returns false when the holder is not verified", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockResolvedValue({ result: [false, 0n, 0n] });
    await expect(hasClaim(WALLET, "kyc")).resolves.toBe(false);
  });

  it("returns true when the holder is verified", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockResolvedValue({ result: [true, 1_700_000_000n, 1_800_000_000n] });
    await expect(hasClaim(WALLET, "kyc")).resolves.toBe(true);
  });

  it("returns false when check_claim throws under fail-soft", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    checkClaim.mockRejectedValue(new Error("rpc timeout"));
    await expect(hasClaim(WALLET, "age", { minThreshold: 21 })).resolves.toBe(false);
  });
});

describe("hasClaim — throwOnError", () => {
  beforeEach(() => {
    isVerified.mockReset();
    checkClaim.mockReset();
  });

  afterEach(() => {
    configure({ registryId: "C_TEST_REGISTRY" });
  });

  it("throws ConfigError when registryId is missing", async () => {
    configure({ registryId: "" });
    await expect(hasClaim(WALLET, "kyc", { throwOnError: true })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("throws RpcError when is_verified fails, not ConfigError", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockRejectedValue(new Error("connection reset"));
    const err = await hasClaim(WALLET, "kyc", { throwOnError: true }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).not.toBeInstanceOf(ConfigError);
    expect((err as RpcError).cause).toBeInstanceOf(Error);
  });

  it("throws RpcError when check_claim fails", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    checkClaim.mockRejectedValue(new Error("simulation failed"));
    await expect(
      hasClaim(WALLET, "funds", { minThreshold: 50_000, throwOnError: true }),
    ).rejects.toBeInstanceOf(RpcError);
  });

  it("still returns false for not-verified (does not throw)", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockResolvedValue({ result: [false, 0n, 0n] });
    await expect(hasClaim(WALLET, "kyc", { throwOnError: true })).resolves.toBe(false);
  });

  it("returns true for verified claims", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockResolvedValue({ result: [true, 10n, 20n] });
    await expect(hasClaim(WALLET, "kyc", { throwOnError: true })).resolves.toBe(true);
  });
});

describe("getClaims — throwOnError", () => {
  beforeEach(() => {
    isVerified.mockReset();
  });

  it("fail-soft returns [] when unconfigured", async () => {
    configure({ registryId: "" });
    await expect(getClaims(WALLET)).resolves.toEqual([]);
  });

  it("throws ConfigError when unconfigured and throwOnError", async () => {
    configure({ registryId: "" });
    await expect(getClaims(WALLET, { throwOnError: true })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws RpcError when a read fails under throwOnError", async () => {
    configure({ registryId: "C_TEST_REGISTRY" });
    isVerified.mockRejectedValue(new Error("boom"));
    await expect(getClaims(WALLET, { throwOnError: true })).rejects.toBeInstanceOf(RpcError);
  });
});
