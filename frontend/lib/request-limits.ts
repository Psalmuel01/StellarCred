import { NextRequest, NextResponse } from "next/server";

// Request body-size guard for the API routes.
//
// `await req.json()` buffers and parses the entire body before any validation
// runs, so an oversized payload is work the signing/witness routes do for free
// on behalf of the caller. Every payload these routes accept is a small JSON
// object (a credential, a witness input map), so 64 KB is generous.
//
// Two layers, both cheap:
//   1. `Content-Length` — rejects a declared-oversized body without reading a
//      single byte.
//   2. A streaming read that aborts the moment the accumulated chunks exceed
//      the cap, so a request that lies about (or omits) `Content-Length` still
//      never gets fully buffered.
//
// The body is never logged, and never appears in the error response.

/** Maximum accepted request body, in bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

export type BodyError = {
  status: 400 | 413;
  /** Machine-readable reason, safe to expose. */
  code: "payload_too_large" | "invalid_json";
  message: string;
};

export type BodyResult<T> = { ok: true; body: T } | { ok: false; error: BodyError };

const tooLarge = (maxBytes: number): BodyError => ({
  status: 413,
  code: "payload_too_large",
  message: `Request body exceeds the ${maxBytes}-byte limit`,
});

/**
 * Rejects a request whose `Content-Length` already exceeds `maxBytes`, without
 * touching the body. Returns `null` when the request is allowed to proceed.
 *
 * Use directly on routes that never read a body (a GET handler still has to
 * refuse an oversized one); {@link readJsonBody} applies this first.
 */
export function checkContentLength(
  req: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): BodyError | null {
  const header = req.headers.get("content-length");
  if (header === null) return null;

  const declared = Number(header);
  // A malformed Content-Length is not a size failure — leave it to the
  // streaming guard, which enforces the cap regardless of what was declared.
  if (!Number.isFinite(declared)) return null;
  return declared > maxBytes ? tooLarge(maxBytes) : null;
}

/**
 * Reads and parses a JSON request body, enforcing `maxBytes`.
 *
 * Replaces a bare `await req.json()`: the caller gets a `413` for an oversized
 * body and a `400` for malformed JSON, and at no point is more than `maxBytes`
 * of the body held in memory.
 */
export async function readJsonBody<T>(
  req: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BodyResult<T>> {
  const declaredTooLarge = checkContentLength(req, maxBytes);
  if (declaredTooLarge) return { ok: false, error: declaredTooLarge };

  const body = req.body;
  // No stream to read (an empty body, or a runtime that already buffered it).
  // Fall back to the built-in parse — the Content-Length check above still
  // capped it, and there is nothing to stream-guard.
  if (!body) {
    try {
      return { ok: true, body: (await req.json()) as T };
    } catch {
      return { ok: false, error: { status: 400, code: "invalid_json", message: "Invalid JSON" } };
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling from the stream as soon as the cap is passed — the
        // remainder of the payload is never read into memory.
        await reader.cancel().catch(() => {});
        return { ok: false, error: tooLarge(maxBytes) };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      error: { status: 400, code: "invalid_json", message: "Could not read request body" },
    };
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(buf)) as T };
  } catch {
    return { ok: false, error: { status: 400, code: "invalid_json", message: "Invalid JSON" } };
  }
}

/** Renders a {@link BodyError} as the JSON response body these routes return. */
export function bodyErrorResponse(error: BodyError): NextResponse {
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
}
