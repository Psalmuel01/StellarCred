/**
 * rate-limit.test.ts — Unit tests for RateLimiter and middleware.
 */

import express, { Request } from "express";
import request from "supertest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  describe("IP extraction", () => {
    beforeEach(() => {
      limiter = new RateLimiter({ windowMs: 60000, max: 5 });
    });

    it("prefers first IP in x-forwarded-for header", () => {
      const req = {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
      } as unknown as Request;
      expect(limiter.extractIp(req)).toBe("203.0.113.195");
    });

    it("handles array x-forwarded-for header", () => {
      const req = {
        headers: { "x-forwarded-for": ["198.51.100.1, 10.0.0.1"] },
      } as unknown as Request;
      expect(limiter.extractIp(req)).toBe("198.51.100.1");
    });

    it("uses x-real-ip if x-forwarded-for is missing", () => {
      const req = {
        headers: { "x-real-ip": "198.51.100.24" },
      } as unknown as Request;
      expect(limiter.extractIp(req)).toBe("198.51.100.24");
    });

    it("uses cf-connecting-ip if other proxy headers are missing", () => {
      const req = {
        headers: { "cf-connecting-ip": "192.0.2.1" },
      } as unknown as Request;
      expect(limiter.extractIp(req)).toBe("192.0.2.1");
    });

    it("falls back to req.ip or socket remote address", () => {
      const reqWithIp = { headers: {}, ip: "10.0.0.5" } as unknown as Request;
      expect(limiter.extractIp(reqWithIp)).toBe("10.0.0.5");

      const reqWithSocket = {
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as Request;
      expect(limiter.extractIp(reqWithSocket)).toBe("127.0.0.1");

      const emptyReq = { headers: {} } as unknown as Request;
      expect(limiter.extractIp(emptyReq)).toBe("127.0.0.1");
    });
  });

  describe("check logic", () => {
    it("allows requests up to max and rejects when exceeded", () => {
      limiter = new RateLimiter({ windowMs: 60000, max: 3 });
      const now = 1000000;

      const r1 = limiter.check("1.2.3.4", now);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
      expect(r1.limit).toBe(3);

      const r2 = limiter.check("1.2.3.4", now + 1000);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.check("1.2.3.4", now + 2000);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      const r4 = limiter.check("1.2.3.4", now + 3000);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.resetSeconds).toBe(57); // ceil((1000000 + 60000 - 1003000) / 1000)
    });

    it("resets quota after window expires", () => {
      limiter = new RateLimiter({ windowMs: 60000, max: 2 });
      const now = 1000000;

      limiter.check("1.2.3.4", now);
      limiter.check("1.2.3.4", now + 1000);
      expect(limiter.check("1.2.3.4", now + 2000).allowed).toBe(false);

      // Window expires at now + 60000 = 1060000
      const afterWindow = now + 60001;
      const resetResult = limiter.check("1.2.3.4", afterWindow);
      expect(resetResult.allowed).toBe(true);
      expect(resetResult.remaining).toBe(1);
    });

    it("isolates counters between different IPs", () => {
      limiter = new RateLimiter({ windowMs: 60000, max: 2 });
      const now = 1000000;

      limiter.check("1.1.1.1", now);
      limiter.check("1.1.1.1", now);
      expect(limiter.check("1.1.1.1", now).allowed).toBe(false);

      // Another IP is unaffected
      const otherResult = limiter.check("2.2.2.2", now);
      expect(otherResult.allowed).toBe(true);
      expect(otherResult.remaining).toBe(1);
    });

    it("always allows when enabled is false", () => {
      limiter = new RateLimiter({ windowMs: 60000, max: 1, enabled: false });
      const now = 1000000;

      expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
      expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
      expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
    });

    it("cleans up expired entries", () => {
      limiter = new RateLimiter({ windowMs: 10000, max: 5 });
      const now = 1000000;

      limiter.check("1.1.1.1", now);
      limiter.check("2.2.2.2", now + 5000);

      // Advance past 1.1.1.1's window (1010000) but not 2.2.2.2's window (1015000)
      limiter.cleanup(now + 11000);
      expect(limiter.check("1.1.1.1", now + 11000).remaining).toBe(4); // fresh window
      expect(limiter.check("2.2.2.2", now + 11000).remaining).toBe(3); // continued window
    });
  });

  describe("Express middleware integration", () => {
    function createTestApp(max: number, windowMs: number = 60000) {
      const app = express();
      limiter = new RateLimiter({ windowMs, max });
      app.use(limiter.middleware());
      app.get("/data", (_req, res) => {
        res.json({ success: true });
      });
      return app;
    }

    it("attaches rate limit headers on allowed requests", async () => {
      const app = createTestApp(5);
      const res = await request(app)
        .get("/data")
        .set("X-Forwarded-For", "10.0.0.1");

      expect(res.status).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBe("5");
      expect(res.headers["ratelimit-remaining"]).toBe("4");
      expect(res.headers["ratelimit-reset"]).toBeDefined();
      expect(res.headers["retry-after"]).toBeUndefined();
    });

    it("returns 429 and Retry-After when rate limit is exceeded", async () => {
      const app = createTestApp(2);

      // 1st request - ok
      const r1 = await request(app)
        .get("/data")
        .set("X-Forwarded-For", "192.168.1.50");
      expect(r1.status).toBe(200);

      // 2nd request - ok
      const r2 = await request(app)
        .get("/data")
        .set("X-Forwarded-For", "192.168.1.50");
      expect(r2.status).toBe(200);

      // 3rd request - throttled (429)
      const r3 = await request(app)
        .get("/data")
        .set("X-Forwarded-For", "192.168.1.50");
      expect(r3.status).toBe(429);
      expect(r3.headers["retry-after"]).toBeDefined();
      expect(Number(r3.headers["retry-after"])).toBeGreaterThan(0);
      expect(r3.body).toMatchObject({
        error: "too many requests",
        retryAfter: expect.any(Number),
      });

      // Different IP is not throttled
      const rOther = await request(app)
        .get("/data")
        .set("X-Forwarded-For", "192.168.1.99");
      expect(rOther.status).toBe(200);
    });
  });
});
