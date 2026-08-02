import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPlaidBalance } from "./plaid";

describe("fetchPlaidBalance", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PLAID_ACCESS_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the mock balance when PLAID_ACCESS_TOKEN is not set", async () => {
    const result = await fetchPlaidBalance("req-1");
    expect(result).toEqual({ ok: true, mock: true, balance: 50000 });
  });

  it("returns a structured PLAID_TIMEOUT error when the request is aborted", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    process.env.PLAID_CLIENT_ID = "client";
    process.env.PLAID_SECRET = "secret";

    global.fetch = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const result = await fetchPlaidBalance("req-2");
    expect(result).toEqual({
      ok: false,
      status: 504,
      code: "PLAID_TIMEOUT",
      error: "Balance verification timed out. Please try again.",
    });
  });

  it("returns a structured PLAID_UNAVAILABLE error on a network failure", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await fetchPlaidBalance("req-3");
    expect(result).toEqual({
      ok: false,
      status: 502,
      code: "PLAID_UNAVAILABLE",
      error: "Balance verification service is unavailable. Please try again.",
    });
  });

  it("returns a structured PLAID_ERROR without leaking Plaid's raw error_message", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error_code: "ITEM_LOGIN_REQUIRED",
          error_message: "the access token for this item is no longer valid: super secret detail",
        }),
    });

    const result = await fetchPlaidBalance("req-4");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.code).toBe("PLAID_ERROR");
      expect(result.error).not.toContain("super secret detail");
      expect(result.error).not.toContain("ITEM_LOGIN_REQUIRED");
    }
  });

  it("returns PLAID_UNAVAILABLE when Plaid's response body isn't valid JSON", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("invalid json")),
    });

    const result = await fetchPlaidBalance("req-5");
    expect(result).toEqual({
      ok: false,
      status: 502,
      code: "PLAID_UNAVAILABLE",
      error: "Balance verification service returned an invalid response.",
    });
  });

  it("returns the highest-balance depository account on success", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accounts: [
            { type: "depository", name: "Checking", balances: { available: 1200 } },
            { type: "depository", name: "Savings", balances: { available: 9800 } },
            { type: "credit", name: "Credit Card", balances: { available: 500 } },
          ],
        }),
    });

    const result = await fetchPlaidBalance("req-6");
    expect(result).toEqual({
      ok: true,
      balance: 9800,
      accounts: [
        { name: "Savings", available: 9800 },
        { name: "Checking", available: 1200 },
      ],
    });
  });

  it("passes an AbortSignal to fetch so a hung request can actually be cancelled", async () => {
    process.env.PLAID_ACCESS_TOKEN = "token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [] }),
    });
    global.fetch = fetchMock;

    await fetchPlaidBalance("req-7");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
