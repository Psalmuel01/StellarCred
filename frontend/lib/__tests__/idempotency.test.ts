import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  idempotencyGet,
  idempotencySet,
  idempotencyCleanup,
  idempotencyClear,
  idempotencySize,
  idempotencyInFlightBegin,
  idempotencyInFlightSettle,
  idempotencyInFlightFail,
  idempotencyInFlightSize,
  isValidIdempotencyKey,
  MAX_KEY_LENGTH_BYTES,
  CachedResponse,
} from "../idempotency";

function makeEntry(overrides: Partial<CachedResponse> = {}): CachedResponse {
  return {
    status: 200,
    body: JSON.stringify({ credentials: [{ type: "kyc", value: "0xabc" }] }),
    headers: { "content-type": "application/json" },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("idempotency store", () => {
  beforeEach(() => {
    idempotencyClear();
  });

  afterEach(() => {
    idempotencyClear();
  });

  describe("idempotencyGet", () => {
    it("returns null on cache miss (key not set)", () => {
      expect(idempotencyGet("key-1")).toBeNull();
    });

    it("returns the cached response on cache hit", () => {
      const entry = makeEntry();
      idempotencySet("key-1", entry);
      const cached = idempotencyGet("key-1");
      expect(cached).not.toBeNull();
      expect(cached!.status).toBe(200);
      expect(cached!.body).toBe(entry.body);
      expect(cached!.headers).toEqual(entry.headers);
    });

    it("returns null for a different key (independent keys)", () => {
      idempotencySet("key-a", makeEntry());
      expect(idempotencyGet("key-b")).toBeNull();
    });

    it("returns the correct response for each independent key", () => {
      const entryA = makeEntry({ status: 200 });
      const entryB = makeEntry({ status: 400, body: JSON.stringify({ error: "bad" }) });
      idempotencySet("key-a", entryA);
      idempotencySet("key-b", entryB);
      expect(idempotencyGet("key-a")!.status).toBe(200);
      expect(idempotencyGet("key-b")!.status).toBe(400);
    });

    it("returns null after TTL expiry", () => {
      // Use Date.now mocking to simulate passage of time.
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      idempotencySet("key-1", makeEntry({ createdAt: now }));

      // Advance time past the default 60-second TTL + 1 ms.
      nowSpy.mockReturnValue(now + 61_000);

      expect(idempotencyGet("key-1")).toBeNull();

      vi.restoreAllMocks();
    });

    it("still hits just before TTL expires", () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      idempotencySet("key-1", makeEntry({ createdAt: now }));

      // 59 seconds later — still valid.
      nowSpy.mockReturnValue(now + 59_000);

      expect(idempotencyGet("key-1")).not.toBeNull();

      vi.restoreAllMocks();
    });

    it("returns null for empty string key (treated as missing)", () => {
      // Empty keys are not stored; the store handles them gracefully.
      expect(idempotencyGet("")).toBeNull();
    });
  });

  describe("idempotencySet", () => {
    it("stores an entry and increments size", () => {
      expect(idempotencySize()).toBe(0);
      idempotencySet("key-1", makeEntry());
      expect(idempotencySize()).toBe(1);
    });

    it("overwrites an existing entry with the same key", () => {
      idempotencySet("key-1", makeEntry({ status: 200 }));
      idempotencySet("key-1", makeEntry({ status: 202 }));
      expect(idempotencySize()).toBe(1);
      expect(idempotencyGet("key-1")!.status).toBe(202);
    });
  });

  describe("idempotencyCleanup", () => {
    it("removes expired entries but keeps fresh ones", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      // Fresh entry.
      idempotencySet("fresh", makeEntry({ createdAt: now }));
      // Expired entry — manually set with old timestamp.
      idempotencySet("stale", makeEntry({ createdAt: now - 61_000 }));

      idempotencyCleanup();

      expect(idempotencyGet("fresh")).not.toBeNull();
      // Expired entry should have been cleaned up and also return null on get.
      expect(idempotencyGet("stale")).toBeNull();
      expect(idempotencySize()).toBe(1);

      vi.restoreAllMocks();
    });

    it("is a no-op when there are no expired entries", () => {
      idempotencySet("key-1", makeEntry());
      idempotencySet("key-2", makeEntry());
      const before = idempotencySize();
      idempotencyCleanup();
      expect(idempotencySize()).toBe(before);
    });
  });

  describe("idempotencyClear", () => {
    it("removes all entries", () => {
      idempotencySet("key-1", makeEntry());
      idempotencySet("key-2", makeEntry());
      expect(idempotencySize()).toBe(2);
      idempotencyClear();
      expect(idempotencySize()).toBe(0);
    });
  });

  describe("idempotencySize", () => {
    it("returns 0 for an empty store", () => {
      expect(idempotencySize()).toBe(0);
    });

    it("returns the correct count after multiple sets", () => {
      idempotencySet("a", makeEntry());
      idempotencySet("b", makeEntry());
      idempotencySet("c", makeEntry());
      expect(idempotencySize()).toBe(3);
    });
  });

  describe("isValidIdempotencyKey", () => {
    it("accepts a normal key", () => {
      expect(isValidIdempotencyKey("key-1")).toBe(true);
    });

    it("rejects empty and whitespace-only keys", () => {
      expect(isValidIdempotencyKey("")).toBe(false);
      expect(isValidIdempotencyKey("   ")).toBe(false);
    });

    it("accepts a key exactly at the byte limit", () => {
      expect(isValidIdempotencyKey("a".repeat(MAX_KEY_LENGTH_BYTES))).toBe(true);
    });

    it("rejects keys longer than the byte limit", () => {
      expect(
        isValidIdempotencyKey("a".repeat(MAX_KEY_LENGTH_BYTES + 1)),
      ).toBe(false);
    });

    it("rejects control characters", () => {
      expect(isValidIdempotencyKey("bad\u0000key")).toBe(false);
      expect(isValidIdempotencyKey("bad\nkey")).toBe(false);
    });
  });

  describe("store guards for invalid keys", () => {
    it("idempotencyGet returns null for invalid keys", () => {
      expect(idempotencyGet("a".repeat(MAX_KEY_LENGTH_BYTES + 1))).toBeNull();
      expect(idempotencyGet("\u0000")).toBeNull();
    });

    it("idempotencySet ignores invalid keys (no memory amplification)", () => {
      idempotencySet("a".repeat(MAX_KEY_LENGTH_BYTES + 1), makeEntry());
      idempotencySet("\u0000", makeEntry());
      expect(idempotencySize()).toBe(0);
    });
  });

  describe("in-flight sentinel", () => {
    it("first caller becomes the leader (begin returns null)", () => {
      expect(idempotencyInFlightBegin("key-1")).toBeNull();
      expect(idempotencyInFlightSize()).toBe(1);
    });

    it("a duplicate caller joins the same in-flight slot", () => {
      expect(idempotencyInFlightBegin("key-1")).toBeNull();
      const joined = idempotencyInFlightBegin("key-1");
      expect(joined).not.toBeNull();
      expect(idempotencyInFlightSize()).toBe(1);
    });

    it("settling resolves waiting duplicates with the produced response", async () => {
      idempotencyInFlightBegin("key-1");
      const joined = idempotencyInFlightBegin("key-1")!;
      const entry = makeEntry({ status: 202 });
      idempotencyInFlightSettle("key-1", entry);
      await expect(joined).resolves.toBe(entry);
      expect(idempotencyInFlightSize()).toBe(0);
    });

    it("a settled slot allows the next caller to become a new leader", async () => {
      idempotencyInFlightBegin("key-1");
      const joined = idempotencyInFlightBegin("key-1")!;
      idempotencyInFlightSettle("key-1", makeEntry());
      await joined;
      expect(idempotencyInFlightBegin("key-1")).toBeNull();
    });

    it("failing rejects waiting duplicates", async () => {
      idempotencyInFlightBegin("key-1");
      const joined = idempotencyInFlightBegin("key-1")!;
      idempotencyInFlightFail("key-1", new Error("boom"));
      await expect(joined).rejects.toThrow("boom");
      expect(idempotencyInFlightSize()).toBe(0);
    });

    it("clear resets in-flight slots", () => {
      idempotencyInFlightBegin("key-1");
      expect(idempotencyInFlightSize()).toBe(1);
      idempotencyClear();
      expect(idempotencyInFlightSize()).toBe(0);
    });

    it("begin ignores invalid keys", () => {
      expect(idempotencyInFlightBegin("")).toBeNull();
      expect(idempotencyInFlightBegin("a".repeat(MAX_KEY_LENGTH_BYTES + 1))).toBeNull();
      expect(idempotencyInFlightSize()).toBe(0);
    });

    it("prunes stale in-flight slots after the TTL (crashed/over-TTL leader)", async () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

      // Leader slot created at `now`; a duplicate joins and awaits it.
      idempotencyInFlightBegin("key-1");
      const joined = idempotencyInFlightBegin("key-1")!;

      // Simulate time passing beyond the 60s TTL; the next begin() prunes
      // the stale slot and the waiting duplicate is released with an error.
      nowSpy.mockReturnValue(now + 61_000);
      idempotencyInFlightBegin("key-2");

      await expect(joined).rejects.toThrow(
        "idempotency in-flight slot expired",
      );
      // Only the fresh key-2 slot remains.
      expect(idempotencyInFlightSize()).toBe(1);

      vi.restoreAllMocks();
    });
  });
});
