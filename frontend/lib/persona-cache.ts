// Short-lived, in-memory store for credentials issued by the Persona
// webhook, keyed by Persona inquiry id so the holder's browser can poll and
// pick them up once ready (see app/api/persona/result). Entries hold exactly
// what a Credential contains — commitment, signature, and the derived
// circuit value needed to prove it later — never the raw identity fields
// Persona returned (name, government ID number, address, ...), which never
// reach this module in the first place.
//
// In-memory only: cleared on process restart, not shared across instances.
// Fine for this app's single-instance deployment target; a multi-instance
// deployment would need a shared store (e.g. Redis) with the same TTL.
import type { Credential } from "@stellarcred/issuer";

const TTL_MS = 15 * 60 * 1000;

interface Entry {
  credentials: Credential[];
  expiresAt: number;
}

const cache = new Map<string, Entry>();

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export function storePersonaResult(inquiryId: string, credentials: Credential[]): void {
  sweep();
  cache.set(inquiryId, { credentials, expiresAt: Date.now() + TTL_MS });
}

export function getPersonaResult(inquiryId: string): Credential[] | null {
  sweep();
  return cache.get(inquiryId)?.credentials ?? null;
}
