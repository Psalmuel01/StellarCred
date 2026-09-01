import { logger, stripSensitiveFields } from "./logger";

// Shared by /api/plaid-balance and the /api/issue issuance flow — both call
// Plaid's balance endpoint the same way, so the timeout/error handling
// lives in one place instead of being duplicated (and drifting) across both.

const PLAID_TIMEOUT_MS = 8_000;

export type PlaidBalanceAccount = { name: string; available: number };

export type PlaidBalanceSuccess = {
  ok: true;
  mock?: true;
  balance: number;
  accounts?: PlaidBalanceAccount[];
};

export type PlaidBalanceFailure = {
  ok: false;
  status: number;
  code: "PLAID_TIMEOUT" | "PLAID_UNAVAILABLE" | "PLAID_ERROR";
  error: string;
};

export type PlaidBalanceResult = PlaidBalanceSuccess | PlaidBalanceFailure;

function plaidBaseUrl(): string {
  const env = process.env.PLAID_ENV ?? "sandbox";
  return env === "production"
    ? "https://production.plaid.com"
    : env === "development"
      ? "https://development.plaid.com"
      : "https://sandbox.plaid.com";
}

/**
 * Fetches the verified balance from Plaid, or returns the mock balance when
 * PLAID_ACCESS_TOKEN isn't configured. Bounded by an explicit timeout so a
 * slow/hung Plaid response can't hang the caller (the issuance flow in
 * particular). Never surfaces raw Plaid error text (or credentials) to the
 * caller or the logs — only a stable `code` and a generic message.
 */
export async function fetchPlaidBalance(requestId: string): Promise<PlaidBalanceResult> {
  if (!process.env.PLAID_ACCESS_TOKEN) {
    const rawMockBalance = process.env.PLAID_MOCK_BALANCE;
    const parsedMockBalance = rawMockBalance !== undefined ? Number(rawMockBalance) : NaN;
    const mockBalance =
      Number.isFinite(parsedMockBalance) && parsedMockBalance >= 0 ? parsedMockBalance : 50000;

    logger.warn(
      stripSensitiveFields({ event: "plaid_mock_mode", requestId }),
      `PLAID_ACCESS_TOKEN not set — returning mock balance $${mockBalance.toLocaleString()}`,
    );

    return { ok: true, mock: true, balance: mockBalance };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), PLAID_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${plaidBaseUrl()}/accounts/balance/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: process.env.PLAID_ACCESS_TOKEN,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = (err as { name?: string }).name === "AbortError";
    logger.error(
      stripSensitiveFields({
        event: isTimeout ? "plaid_timeout" : "plaid_network_error",
        requestId,
      }),
    );
    return isTimeout
      ? {
          ok: false,
          status: 504,
          code: "PLAID_TIMEOUT",
          error: "Balance verification timed out. Please try again.",
        }
      : {
          ok: false,
          status: 502,
          code: "PLAID_UNAVAILABLE",
          error: "Balance verification service is unavailable. Please try again.",
        };
  } finally {
    clearTimeout(timeoutHandle);
  }

  let result: { error_code?: string; accounts?: unknown };
  try {
    result = await response.json();
  } catch {
    logger.error(stripSensitiveFields({ event: "plaid_invalid_response", requestId }));
    return {
      ok: false,
      status: 502,
      code: "PLAID_UNAVAILABLE",
      error: "Balance verification service returned an invalid response.",
    };
  }

  // Only the stable error_code enum is logged — never error_message, which
  // can embed more free-form (and potentially sensitive) detail.
  logger.info(
    stripSensitiveFields({
      event: "plaid_response",
      outcome: result.error_code ?? "ok",
      requestId,
    }),
  );

  if (!response.ok || result.error_code) {
    return {
      ok: false,
      status: 502,
      code: "PLAID_ERROR",
      error: "Balance verification failed.",
    };
  }

  const accounts: Array<{
    type: string;
    name: string;
    balances: { available: number | null };
  }> = (result.accounts as never) ?? [];

  const depository = accounts
    .filter((a) => a.type === "depository")
    .map((a) => ({ name: a.name, available: a.balances.available ?? 0 }))
    .sort((a, b) => b.available - a.available);

  return {
    ok: true,
    balance: depository[0]?.available ?? 0,
    accounts: depository,
  };
}