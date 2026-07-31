import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import {
  MAX_BODY_BYTES,
  checkContentLength,
  readJsonBody,
  bodyErrorResponse,
} from "../request-limits";

/**
 * The helpers only touch `headers`, `body` and `json()`, so a plain `Request`
 * stands in for a `NextRequest` here.
 */
function request(body: string | null, headers: Record<string, string> = {}): NextRequest {
  const init: RequestInit & { duplex?: string } = { method: "POST", headers };
  if (body !== null) init.body = body;
  return new Request("http://localhost/api/test", init as RequestInit) as unknown as NextRequest;
}

/** A body with no Content-Length, streamed in chunks. */
function streamedRequest(chunks: string[]): NextRequest {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Request("http://localhost/api/test", {
    method: "POST",
    body: stream,
    // Required by undici when the body is a stream.
    duplex: "half",
  } as RequestInit) as unknown as NextRequest;
}

describe("checkContentLength", () => {
  it("allows a request with no Content-Length", () => {
    expect(checkContentLength(request(null))).toBeNull();
  });

  it("allows a declared size at the limit", () => {
    expect(
      checkContentLength(request(null, { "content-length": String(MAX_BODY_BYTES) })),
    ).toBeNull();
  });

  it("rejects a declared size over the limit without reading the body", () => {
    const err = checkContentLength(request(null, { "content-length": String(MAX_BODY_BYTES + 1) }));
    expect(err).toMatchObject({ status: 413, code: "payload_too_large" });
  });

  it("defers a malformed Content-Length to the streaming guard", () => {
    expect(checkContentLength(request(null, { "content-length": "not-a-number" }))).toBeNull();
  });

  it("honours a caller-supplied limit", () => {
    expect(checkContentLength(request(null, { "content-length": "200" }), 100)).toMatchObject({
      status: 413,
    });
  });
});

describe("readJsonBody", () => {
  it("parses a normal payload", async () => {
    const result = await readJsonBody<{ type: string }>(request(JSON.stringify({ type: "kyc" })));
    expect(result).toEqual({ ok: true, body: { type: "kyc" } });
  });

  it("returns a 400 for malformed JSON", async () => {
    const result = await readJsonBody(request("{not json"));
    expect(result).toEqual({
      ok: false,
      error: { status: 400, code: "invalid_json", message: "Invalid JSON" },
    });
  });

  it("returns a 413 for a body over the limit", async () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
    const result = await readJsonBody(request(big));
    expect(result).toMatchObject({ ok: false, error: { status: 413, code: "payload_too_large" } });
  });

  it("rejects an oversized streamed body that declares no Content-Length", async () => {
    // Ten chunks of 20 KB against a 64 KB cap — the guard has to trip
    // part-way through rather than after buffering all 200 KB.
    const chunks = Array.from({ length: 10 }, () => "y".repeat(20 * 1024));
    const result = await readJsonBody(streamedRequest(chunks));
    expect(result).toMatchObject({ ok: false, error: { status: 413 } });
  });

  it("accepts a streamed body under the limit", async () => {
    const result = await readJsonBody<{ a: number }>(streamedRequest(['{"a"', ":1}"]));
    expect(result).toEqual({ ok: true, body: { a: 1 } });
  });

  it("honours a caller-supplied limit", async () => {
    const result = await readJsonBody(request(JSON.stringify({ pad: "x".repeat(200) })), 100);
    expect(result).toMatchObject({ ok: false, error: { status: 413 } });
  });
});

describe("bodyErrorResponse", () => {
  it("renders the status and a structured body that omits the payload", async () => {
    const res = bodyErrorResponse({
      status: 413,
      code: "payload_too_large",
      message: "Request body exceeds the 65536-byte limit",
    });
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: "Request body exceeds the 65536-byte limit",
      code: "payload_too_large",
    });
  });
});
