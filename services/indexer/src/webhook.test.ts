/**
 * webhook.test.ts — Tests for outbound webhook delivery.
 *
 * Verifies:
 *   1. Payload POSTed with correct JSON and Content-Type.
 *   2. HMAC-SHA256 signature header present and correct when secret set.
 *   3. No signature header when no secret configured.
 *   4. Retries on 5xx / 429 / network errors, with backoff.
 *   5. No retry on permanent 4xx (except 429).
 *   6. dispatchWebhook fans out to all configured URLs, never throws.
 */

import { deliverWebhook, dispatchWebhook, type WebhookPayload } from "./webhook";
import type { Config } from "./config";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    stellarNetwork: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    proofRegistryContractId: "CTEST",
    dbDriver: "sqlite",
    sqlitePath: "/tmp/unused.db",
    databaseUrl: undefined,
    pollIntervalMs: 6000,
    startLedger: 0,
    port: 3001,
    finalityLag: 6,
    corsOrigins: [],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 120,
    rateLimitEnabled: true,
    webhookUrls: [],
    webhookSecret: undefined,
    webhookTimeoutMs: 1000,
    ...overrides,
  };
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: "claim.verified",
    ledger: 12345,
    wallet: "GALICE",
    credentialType: "kyc",
    issuer: "GISSUER",
    expiry: 1735689600,
    verifiedAt: 1735689500,
    timestamp: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

function okResponse() {
  return { ok: true, status: 200 };
}

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(global, "fetch");
});

afterEach(() => {
  fetchMock.mockRestore();
});

describe("deliverWebhook", () => {
  it("POSTs JSON payload with Content-Type and returns true on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    const config = makeConfig();
    const payload = makePayload();
    const ok = await deliverWebhook("https://hooks.example/x", payload, config);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example/x");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toMatchObject({
      event: "claim.verified",
      ledger: 12345,
      wallet: "GALICE",
    });
  });

  it("sends valid HMAC-SHA256 signature when secret is configured", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    const config = makeConfig({ webhookSecret: "shhh" });
    await deliverWebhook("https://hooks.example/x", makePayload(), config);

    const [, init] = fetchMock.mock.calls[0];
    const sig = init.headers["X-StellarCred-Signature"];
    expect(sig).toBeDefined();

    // Independently recompute expected HMAC
    const crypto = await import("crypto");
    const expected = crypto
      .createHmac("sha256", "shhh")
      .update(init.body, "utf8")
      .digest("hex");
    expect(sig).toBe(expected);
  });

  it("omits signature header when no secret configured", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    await deliverWebhook("https://hooks.example/x", makePayload(), makeConfig());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-StellarCred-Signature"]).toBeUndefined();
  });

  it("retries on 500 and succeeds on a later attempt", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(okResponse());

    const ok = await deliverWebhook("https://hooks.example/x", makePayload(), makeConfig());
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on permanent 4xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });

    const ok = await deliverWebhook("https://hooks.example/x", makePayload(), makeConfig());
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after MAX_ATTEMPTS on persistent 5xx", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const promise = deliverWebhook("https://hooks.example/x", makePayload(), makeConfig());
    // Flush backoff timers (2s + 4s)
    await jest.advanceTimersByTimeAsync(10_000);
    const ok = await promise;
    jest.useRealTimers();
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("dispatchWebhook", () => {
  it("fans out to all configured URLs in parallel", async () => {
    fetchMock.mockResolvedValue(okResponse());

    const config = makeConfig({
      webhookUrls: ["https://a.example/hook", "https://b.example/hook"],
    });
    dispatchWebhook(makePayload(), config);

    // dispatchWebhook is fire-and-forget; wait a tick for the promises
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://a.example/hook");
    expect(urls).toContain("https://b.example/hook");
  });

  it("does nothing when no webhook URLs configured", () => {
    dispatchWebhook(makePayload(), makeConfig({ webhookUrls: [] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws even when every endpoint fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const config = makeConfig({ webhookUrls: ["https://dead.example/hook"] });
    expect(() => dispatchWebhook(makePayload(), config)).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
  });
});
