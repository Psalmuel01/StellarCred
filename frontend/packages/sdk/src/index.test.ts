import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { configure, hasClaim, invalidate, StellarCred } from "./index";

describe("StellarCred SDK Cache", () => {
  let rpcCallCount = 0;

  beforeEach(() => {
    rpcCallCount = 0;
    invalidate(); // clear cache
    configure({
      cacheEnabled: false,
      cacheTtlMs: 30000,
      readIsVerified: async () => {
        rpcCallCount++;
        return { valid: true, verifiedAt: 1000, expiry: 2000 };
      },
      readCheckClaim: async () => {
        rpcCallCount++;
        return true;
      },
    });
  });

  it("is disabled by default and makes an RPC call on every hasClaim read", async () => {
    const res1 = await hasClaim("G123", "kyc");
    assert.strictEqual(res1, true);
    assert.strictEqual(rpcCallCount, 1);

    const res2 = await hasClaim("G123", "kyc");
    assert.strictEqual(res2, true);
    assert.strictEqual(rpcCallCount, 2);
  });

  it("serves repeated reads within TTL from cache when opt-in enabled (hit & miss)", async () => {
    configure({ cacheEnabled: true, cacheTtlMs: 5000 });

    // Miss: 1st call
    const res1 = await hasClaim("G123", "kyc");
    assert.strictEqual(res1, true);
    assert.strictEqual(rpcCallCount, 1);

    // Hit: 2nd call within TTL
    const res2 = await hasClaim("G123", "kyc");
    assert.strictEqual(res2, true);
    assert.strictEqual(rpcCallCount, 1);

    // Miss: Different claim type
    const res3 = await hasClaim("G123", "age");
    assert.strictEqual(res3, true);
    assert.strictEqual(rpcCallCount, 2);

    // Miss: Different threshold
    const res4 = await hasClaim("G123", "age", { minThreshold: 21 });
    assert.strictEqual(res4, true);
    assert.strictEqual(rpcCallCount, 3);

    // Hit: Same threshold
    const res5 = await hasClaim("G123", "age", { minThreshold: 21 });
    assert.strictEqual(res5, true);
    assert.strictEqual(rpcCallCount, 3);
  });

  it("expires cache entries after TTL", async () => {
    configure({ cacheEnabled: true, cacheTtlMs: 100 });

    const res1 = await hasClaim("G123", "kyc");
    assert.strictEqual(res1, true);
    assert.strictEqual(rpcCallCount, 1);

    // Immediate repeat read (hit)
    const res2 = await hasClaim("G123", "kyc");
    assert.strictEqual(res2, true);
    assert.strictEqual(rpcCallCount, 1);

    // Wait for TTL expiry
    await new Promise((r) => setTimeout(r, 150));

    // Post-expiry read (miss)
    const res3 = await hasClaim("G123", "kyc");
    assert.strictEqual(res3, true);
    assert.strictEqual(rpcCallCount, 2);
  });

  it("clears entries with invalidate(wallet, credentialType)", async () => {
    configure({ cacheEnabled: true, cacheTtlMs: 60000 });

    await hasClaim("G123", "kyc");
    await hasClaim("G123", "age");
    assert.strictEqual(rpcCallCount, 2);

    // Invalidate only kyc for G123
    invalidate("G123", "kyc");

    // kyc should miss
    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 3);

    // age should still hit cache
    await hasClaim("G123", "age");
    assert.strictEqual(rpcCallCount, 3);
  });

  it("clears all wallet entries with invalidate(wallet)", async () => {
    configure({ cacheEnabled: true, cacheTtlMs: 60000 });

    await hasClaim("G123", "kyc");
    await hasClaim("G123", "age");
    await hasClaim("G456", "kyc");
    assert.strictEqual(rpcCallCount, 3);

    // Invalidate all claims for G123
    invalidate("G123");

    // Both G123 claims should miss
    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 4);
    await hasClaim("G123", "age");
    assert.strictEqual(rpcCallCount, 5);

    // G456 claim should still hit cache
    await hasClaim("G456", "kyc");
    assert.strictEqual(rpcCallCount, 5);
  });

  it("clears entire cache with invalidate() without args", async () => {
    configure({ cacheEnabled: true, cacheTtlMs: 60000 });

    await hasClaim("G123", "kyc");
    await hasClaim("G456", "kyc");
    assert.strictEqual(rpcCallCount, 2);

    invalidate();

    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 3);
    await hasClaim("G456", "kyc");
    assert.strictEqual(rpcCallCount, 4);
  });

  it("supports opt-in and TTL configuration via nested cache object or flat options", async () => {
    configure({ cache: { enabled: true, ttlMs: 100 } });

    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 1);

    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 1);

    await new Promise((r) => setTimeout(r, 150));

    await hasClaim("G123", "kyc");
    assert.strictEqual(rpcCallCount, 2);
  });

  it("exposes invalidate on StellarCred export object", () => {
    assert.strictEqual(typeof StellarCred.invalidate, "function");
  });
});
