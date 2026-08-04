import { describe, it, expect, vi } from "vitest";

// lib/wallet pulls in @stellar/freighter-api, a CJS module vitest can't load as
// ESM — and none of these tests reach a signing path anyway.
vi.mock("../wallet", () => ({ signTx: vi.fn() }));

import { MAX_BATCH_SIZE, submitProofs, type ProofSubmissionParams } from "../contracts";

// These guards run before any wallet or RPC work, so they can be exercised
// without a configured registry or a connected wallet.

const submission = (credentialType: string): ProofSubmissionParams => ({
  issuerId: "GISSUER",
  credentialType,
  proof: new Uint8Array([1, 2, 3]),
  publicInputs: new Uint8Array([4, 5, 6]),
  ttlSecs: 3600,
});

const submit = (types: string[]) =>
  submitProofs({ holder: "GHOLDER", submissions: types.map(submission) });

describe("submitProofs pre-flight limits", () => {
  it("mirrors the contract's MAX_BATCH_SIZE", () => {
    expect(MAX_BATCH_SIZE).toBe(5);
  });

  it("rejects an empty batch", async () => {
    await expect(submit([])).rejects.toThrow(/at least one proof/);
  });

  it("rejects more than MAX_BATCH_SIZE proofs", async () => {
    const types = ["kyc", "age", "income", "funds", "accreditation", "jurisdiction"];
    expect(types.length).toBeGreaterThan(MAX_BATCH_SIZE);
    await expect(submit(types)).rejects.toThrow(
      `Batch submission accepts at most ${MAX_BATCH_SIZE} proofs, received ${types.length}.`,
    );
  });

  it("rejects two proofs of the same credential type", async () => {
    await expect(submit(["age", "kyc", "age"])).rejects.toThrow(
      "Batch submission contains two age proofs.",
    );
  });

  it("lets a full batch of distinct types through to the registry check", async () => {
    // No registry id is configured under test, so a batch that passes every
    // pre-flight check fails at the next step — which is what proves it passed.
    await expect(submit(["kyc", "age", "income", "funds", "accreditation"])).rejects.toThrow(
      /ProofRegistry contract id not set/,
    );
  });
});
