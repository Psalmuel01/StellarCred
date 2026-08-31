import { describe, expect, it, vi } from "vitest";
import { enqueueProof, flushQueuedProofs, queuedProofCount } from "../offline-queue";

describe("offline proof queue", () => {
  it("queues a submission intent and flushes it in order", async () => {
    const submit = vi.fn().mockResolvedValue("tx-1");
    await enqueueProof({ holder: "Gholder", issuerId: "Gissuer", credentialType: "kyc", commitment: "0xcommit", ttlSecs: 90 });
    expect(queuedProofCount()).toBe(1);
    await flushQueuedProofs(submit);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ holder: "Gholder", commitment: "0xcommit" }));
    expect(queuedProofCount()).toBe(0);
  });

  it("stores no proof bytes or private credential fields", async () => {
    await enqueueProof({ holder: "Gholder", issuerId: "Gissuer", credentialType: "kyc", commitment: "0xcommit", ttlSecs: 90 });
    expect(localStorage.getItem("stellarcred:proof-queue")).not.toContain("proof");
    expect(localStorage.getItem("stellarcred:proof-queue")).not.toContain("value");
  });
});
