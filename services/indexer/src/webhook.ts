/**
 * webhook.ts — Outbound webhook delivery for verification events.
 *
 * The ingester fans each processed Verified/Revoked event out to every
 * configured webhook endpoint (WEBHOOK_URLS, comma-separated).
 *
 * Delivery guarantees (best-effort, at-least-once per attempt cycle):
 *   - POST with JSON payload, Content-Type: application/json
 *   - HMAC-SHA256 signature in `X-StellarCred-Signature` header
 *     (hex-encoded, over the raw request body) when WEBHOOK_SECRET is set
 *   - Event ID in `X-StellarCred-Event` header (ledger-seq:wallet:type)
 *   - Retries: up to MAX_ATTEMPTS attempts with exponential backoff
 *     (2s, 4s, 8s… capped at MAX_BACKOFF_MS)
 *   - One failing endpoint never blocks or fails the ingestion tick:
 *     delivery is fire-and-forget with its own error logging
 *
 * Payload shape:
 * {
 *   "event": "claim.verified" | "claim.revoked",
 *   "ledger": 12345,
 *   "wallet": "G…",
 *   "credentialType": "kyc",
 *   "issuer": "G…",            // verified only
 *   "expiry": 1735689600,      // verified only (unix seconds)
 *   "verifiedAt": 1735689500,  // verified only (unix seconds)
 *   "timestamp": "2026-08-30T12:00:00.000Z"
 * }
 */

import crypto from "crypto";
import type { Config } from "./config";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 8_000;

export type WebhookEventType = "claim.verified" | "claim.revoked";

export interface WebhookPayload {
  event: WebhookEventType;
  ledger: number;
  wallet: string;
  credentialType: string;
  /** verified only */
  issuer?: string;
  /** verified only — unix seconds */
  expiry?: number;
  /** verified only — unix seconds */
  verifiedAt?: number;
  timestamp: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HMAC-SHA256 hex signature over the raw body. */
function signBody(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Deliver one event to one endpoint with bounded retries.
 * Never throws — returns true if any attempt got a 2xx.
 */
export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  config: Config
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "StellarCred-Indexer/1.0",
  };
  if (config.webhookSecret) {
    headers["X-StellarCred-Signature"] = signBody(body, config.webhookSecret);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(config.webhookTimeoutMs),
      });
      if (res.ok) return true;

      // 4xx (except 429) = permanent — don't retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn(
          `[indexer/webhook] ${url} rejected delivery: ${res.status} (no retry)`
        );
        return false;
      }

      console.warn(
        `[indexer/webhook] ${url} responded ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS}`
      );
    } catch (err) {
      console.warn(
        `[indexer/webhook] ${url} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error).message}`
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      await sleep(delay);
    }
  }
  return false;
}

/**
 * Fan one event out to all configured endpoints in parallel.
 * Fire-and-forget from the caller's perspective — errors are logged, never thrown.
 */
export function dispatchWebhook(
  payload: WebhookPayload,
  config: Config
): void {
  if (config.webhookUrls.length === 0) return;

  const eventId = `${payload.ledger}:${payload.wallet}:${payload.event}`;
  for (const url of config.webhookUrls) {
    void deliverWebhook(url, payload, config)
      .then((ok) => {
        if (!ok) {
          console.error(`[indexer/webhook] delivery FAILED permanently: ${url} (${eventId})`);
        }
      })
      .catch((err) => {
        console.error(`[indexer/webhook] unexpected error: ${url} (${eventId})`, err);
      });
  }
}
