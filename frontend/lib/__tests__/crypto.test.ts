import { describe, it, expect } from "vitest";
import { encryptWithPassphrase, decryptWithPassphrase, DecryptionError } from "../crypto";

describe("lib/crypto.ts", () => {
  it("round-trips plaintext through encrypt/decrypt with the right passphrase", async () => {
    const plaintext = JSON.stringify({ type: "kyc", commitment: "0xabc", value: "42" });
    const payload = await encryptWithPassphrase(plaintext, "correct horse battery staple");
    const decrypted = await decryptWithPassphrase(payload, "correct horse battery staple");
    expect(decrypted).toBe(plaintext);
  });

  it("rejects the wrong passphrase", async () => {
    const payload = await encryptWithPassphrase("secret credential data", "right-passphrase");
    await expect(decryptWithPassphrase(payload, "wrong-passphrase")).rejects.toBeInstanceOf(DecryptionError);
  });

  it("produces different ciphertext for the same plaintext+passphrase (random salt/iv)", async () => {
    const a = await encryptWithPassphrase("same plaintext", "same passphrase");
    const b = await encryptWithPassphrase("same plaintext", "same passphrase");
    expect(a).not.toBe(b);
  });

  it("produces a URL-safe payload with no cleartext trace of the plaintext", async () => {
    const secretMarker = "definitely-not-in-ciphertext";
    const payload = await encryptWithPassphrase(`{"secret":"${secretMarker}"}`, "passphrase");
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain(secretMarker);
  });

  it("rejects a corrupted/malformed payload", async () => {
    await expect(decryptWithPassphrase("not-a-real-payload", "whatever")).rejects.toBeInstanceOf(DecryptionError);
  });

  it("rejects a truncated (tampered) payload", async () => {
    const payload = await encryptWithPassphrase("some credential json", "passphrase");
    await expect(decryptWithPassphrase(payload.slice(0, -4), "passphrase")).rejects.toBeInstanceOf(DecryptionError);
  });
});
