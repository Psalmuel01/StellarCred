/**
 * cors.test.ts — Unit tests for CORS middleware and origin parsing.
 */

import express from "express";
import request from "supertest";
import { createCorsMiddleware } from "./cors";
import { parseCorsOrigins } from "./config";

describe("parseCorsOrigins", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("defaults to http://localhost:3000 in non-production when unset", () => {
    process.env.NODE_ENV = "test";
    expect(parseCorsOrigins(undefined)).toEqual(["http://localhost:3000"]);
    expect(parseCorsOrigins("")).toEqual(["http://localhost:3000"]);
    expect(parseCorsOrigins("   ")).toEqual(["http://localhost:3000"]);
  });

  it("defaults to empty array (deny) in production when unset", () => {
    process.env.NODE_ENV = "production";
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
  });

  it("parses single origin", () => {
    expect(parseCorsOrigins("https://app.stellarcred.xyz")).toEqual([
      "https://app.stellarcred.xyz",
    ]);
  });

  it("parses comma-separated list of origins with trimming", () => {
    expect(
      parseCorsOrigins(
        "http://localhost:3000, https://stellarcred.app , https://testnet.stellarcred.app"
      )
    ).toEqual([
      "http://localhost:3000",
      "https://stellarcred.app",
      "https://testnet.stellarcred.app",
    ]);
  });

  it("parses wildcard origin", () => {
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });
});

describe("createCorsMiddleware", () => {
  function createTestApp(allowedOrigins: string[]) {
    const app = express();
    app.use(createCorsMiddleware(allowedOrigins));
    app.get("/test", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("attaches Access-Control-Allow-Origin for allowed origin", async () => {
    const app = createTestApp(["https://app.stellarcred.xyz"]);
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://app.stellarcred.xyz");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.stellarcred.xyz"
    );
  });

  it("does not attach Access-Control-Allow-Origin for disallowed origin", async () => {
    const app = createTestApp(["https://app.stellarcred.xyz"]);
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://malicious.site");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows non-browser requests without Origin header", async () => {
    const app = createTestApp(["https://app.stellarcred.xyz"]);
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows all origins when wildcard is set", async () => {
    const app = createTestApp(["*"]);
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://random-origin.org");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("handles OPTIONS preflight for allowed origin", async () => {
    const app = createTestApp(["https://app.stellarcred.xyz"]);
    const res = await request(app)
      .options("/test")
      .set("Origin", "https://app.stellarcred.xyz")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.stellarcred.xyz"
    );
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });

  it("does not allow OPTIONS preflight for disallowed origin", async () => {
    const app = createTestApp(["https://app.stellarcred.xyz"]);
    const res = await request(app)
      .options("/test")
      .set("Origin", "https://unauthorized.com")
      .set("Access-Control-Request-Method", "GET");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("denies cross-origin by default when allowlist is empty", async () => {
    const app = createTestApp([]);
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://app.stellarcred.xyz");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
