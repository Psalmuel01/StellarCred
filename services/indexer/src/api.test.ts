/**
 * api.test.ts — Unit tests for the HTTP API layer.
 *
 * Uses an in-memory SQLite database (via the real db adapter) so tests are
 * fully self-contained and require no network access.
 */

import request from "supertest";
import type { Application } from "express";
import { buildApp } from "./api";
import { createSqliteDb } from "./db";
import type { Db } from "./db";
import type { Config } from "./config";
import type { Ingester, IngesterHealth } from "./ingester";

import os from "os";
import path from "path";
import fs from "fs";

let db: Db;
let app: Application;
let tmpFile: string;

/** Minimal ingester stub that exposes a controllable health snapshot. */
function makeIngester(overrides?: Partial<IngesterHealth>): Ingester {
  const health: IngesterHealth = {
    lastSuccessLedger: 0,
    headLedger: 0,
    lag: -1,
    lastError: null,
    lastErrorTime: null,
    consecutiveErrors: 0,
    fetchAttempts: 0,
    fetchFailures: 0,
    ...overrides,
  };
  return {
    tick: async () => 0,
    start: () => {},
    stop: () => {},
    getHealth: () => ({ ...health }),
  };
}

function makeConfig(sqlitePath: string): Config {
  return {
    stellarNetwork: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    proofRegistryContractId: "CTEST",
    dbDriver: "sqlite",
    sqlitePath,
    databaseUrl: undefined,
    pollIntervalMs: 6000,
    startLedger: 0,
    port: 3001,
    finalityLag: 6,
    corsOrigins: ["http://localhost:3000"],
    rateLimitWindowMs: 60000,
    rateLimitMax: 120,
    rateLimitEnabled: true,
  };
}

beforeEach(() => {
  // Use a unique temp file per test so each test gets a fresh DB
  tmpFile = path.join(os.tmpdir(), `indexer-test-${Date.now()}-${Math.random()}.db`);
  db = createSqliteDb(makeConfig(tmpFile));
  db.migrate();
  app = buildApp(db, makeIngester());
});

afterEach(() => {
  db.close();
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpFile + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpFile + "-shm"); } catch { /* ignore */ }
});

// ── /health ─────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok and lastLedger 0 on empty db", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      lastLedger: 0,
      headLedger: 0,
      lag: -1,
      consecutiveErrors: 0,
      lastError: null,
    });
  });

  it("reports degraded when consecutiveErrors is 1-2", async () => {
    app = buildApp(db, makeIngester({ consecutiveErrors: 2, lastError: "timeout" }));
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.consecutiveErrors).toBe(2);
    expect(res.body.lastError).toBe("timeout");
  });

  it("reports error when consecutiveErrors >= 3", async () => {
    app = buildApp(db, makeIngester({ consecutiveErrors: 5, lag: 120 }));
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("error");
    expect(res.body.lag).toBe(120);
  });
});

// ── /claims ──────────────────────────────────────────────────────────────────

describe("GET /claims", () => {
  it("returns 400 when wallet param is missing", async () => {
    const res = await request(app).get("/claims");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wallet/i);
  });

  it("returns empty claims array for unknown wallet", async () => {
    const res = await request(app).get("/claims?wallet=GUNKNOWN");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ wallet: "GUNKNOWN", claims: [] });
  });

  it("returns inserted claim for known wallet", async () => {
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      wallet: "GALICE",
      credential_type: "kyc",
      issuer: "GISSUER",
      verified_at: 1000,
      expiry: 9999999,
      ledger_sequence: 42,
      threshold: null,
      revoked: 0,
    });

    const res = await request(app).get("/claims?wallet=GALICE");
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0]).toMatchObject({
      wallet: "GALICE",
      credential_type: "kyc",
      revoked: 0,
    });
  });
});

// ── /stats ────────────────────────────────────────────────────────────────────

describe("GET /stats", () => {
  it("returns empty stats array on empty db", async () => {
    const res = await request(app).get("/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stats: [] });
  });

  it("aggregates counts per credential_type", async () => {
    const base = {
      issuer: "GISSUER",
      verified_at: 1000,
      expiry: 9999999,
      ledger_sequence: 1,
      threshold: null,
      revoked: 0,
    };
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      ...base, wallet: "GA1", credential_type: "kyc",
    });
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      ...base, wallet: "GA2", credential_type: "kyc",
    });
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      ...base, wallet: "GA3", credential_type: "age",
    });

    const res = await request(app).get("/stats");
    expect(res.status).toBe(200);
    const kycRow = res.body.stats.find(
      (r: { credential_type: string }) => r.credential_type === "kyc"
    );
    expect(kycRow).toMatchObject({ total: 2, active: 2, revoked: 0 });
  });
});

// ── /recent ───────────────────────────────────────────────────────────────────

describe("GET /recent", () => {
  it("returns empty array when db is empty", async () => {
    const res = await request(app).get("/recent");
    expect(res.status).toBe(200);
    expect(res.body.claims).toEqual([]);
  });

  it("excludes revoked claims", async () => {
    const base = {
      issuer: "GISSUER",
      verified_at: 1000,
      expiry: 9999999,
      ledger_sequence: 1,
      threshold: null,
    };
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      ...base, wallet: "GA1", credential_type: "kyc", revoked: 0,
    });
    (db as ReturnType<typeof createSqliteDb>).upsertClaim({
      ...base, wallet: "GA2", credential_type: "kyc", revoked: 0,
    });
    // Revoke one
    (db as ReturnType<typeof createSqliteDb>).revokeClaim("GA1", "kyc");

    const res = await request(app).get("/recent");
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0].wallet).toBe("GA2");
  });

  it("respects limit and page params", async () => {
    const base = {
      issuer: "G",
      verified_at: 1000,
      expiry: 9999999,
      ledger_sequence: 1,
      threshold: null,
      revoked: 0,
    };
    for (let i = 1; i <= 5; i++) {
      (db as ReturnType<typeof createSqliteDb>).upsertClaim({
        ...base,
        wallet: `GA${i}`,
        credential_type: "kyc",
        verified_at: i * 1000,
      });
    }

    const res = await request(app).get("/recent?limit=2&page=2");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.page).toBe(2);
    expect(res.body.claims).toHaveLength(2);
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

describe("unknown routes", () => {
  it("returns 404 for unknown path", async () => {
    const res = await request(app).get("/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ── CORS & Rate Limiting Integration ─────────────────────────────────────────

describe("CORS & Rate Limiting integration in API", () => {
  it("emits CORS headers for allowed origin and handles preflight", async () => {
    const customConfig = {
      ...makeConfig(tmpFile),
      corsOrigins: ["https://app.stellarcred.xyz"],
    };
    const customApp = buildApp(db, makeIngester(), customConfig);

    // GET request from allowed origin
    const getRes = await request(customApp)
      .get("/health")
      .set("Origin", "https://app.stellarcred.xyz");
    expect(getRes.status).toBe(200);
    expect(getRes.headers["access-control-allow-origin"]).toBe(
      "https://app.stellarcred.xyz"
    );

    // OPTIONS preflight request
    const optRes = await request(customApp)
      .options("/claims")
      .set("Origin", "https://app.stellarcred.xyz")
      .set("Access-Control-Request-Method", "GET");
    expect(optRes.status).toBe(204);
    expect(optRes.headers["access-control-allow-origin"]).toBe(
      "https://app.stellarcred.xyz"
    );
  });

  it("does not emit CORS headers for untrusted origins", async () => {
    const customConfig = {
      ...makeConfig(tmpFile),
      corsOrigins: ["https://app.stellarcred.xyz"],
    };
    const customApp = buildApp(db, makeIngester(), customConfig);

    const res = await request(customApp)
      .get("/stats")
      .set("Origin", "https://evil.site");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("enforces rate limits and returns 429 + Retry-After when exceeded", async () => {
    const customConfig = {
      ...makeConfig(tmpFile),
      rateLimitMax: 3,
      rateLimitWindowMs: 60000,
      rateLimitEnabled: true,
    };
    const customApp = buildApp(db, makeIngester(), customConfig);

    // 3 allowed requests
    for (let i = 1; i <= 3; i++) {
      const res = await request(customApp)
        .get("/stats")
        .set("X-Forwarded-For", "203.0.113.50");
      expect(res.status).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBe("3");
      expect(res.headers["ratelimit-remaining"]).toBe(String(3 - i));
    }

    // 4th request -> 429
    const throttled = await request(customApp)
      .get("/stats")
      .set("X-Forwarded-For", "203.0.113.50");
    expect(throttled.status).toBe(429);
    expect(throttled.headers["retry-after"]).toBeDefined();
    expect(throttled.body).toMatchObject({
      error: "too many requests",
      retryAfter: expect.any(Number),
    });

    // Another IP is not throttled
    const otherIpRes = await request(customApp)
      .get("/stats")
      .set("X-Forwarded-For", "203.0.113.99");
    expect(otherIpRes.status).toBe(200);
  });
});
