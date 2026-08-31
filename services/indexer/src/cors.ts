/**
 * cors.ts — Configurable CORS middleware for the indexer HTTP API.
 *
 * Provides origin allowlist filtering and preflight handling.
 * - If no origins are allowed (e.g. unconfigured production), default-deny cross-origin requests.
 * - In non-production environments with no config, defaults to http://localhost:3000.
 * - If "*" is present in the allowlist, allows all cross-origin requests.
 */

import cors from "cors";
import type { RequestHandler } from "express";

export interface CorsOptions {
  allowedOrigins: string[];
}

export function createCorsMiddleware(allowedOrigins: string[]): RequestHandler {
  if (allowedOrigins.length === 0) {
    // Default deny cross-origin requests by not attaching Access-Control-Allow-* headers.
    return (_req, _res, next) => next();
  }

  const allowAll = allowedOrigins.includes("*");

  return cors({
    origin: allowAll
      ? "*"
      : (origin, callback) => {
          // Allow requests with no Origin header (same-origin, curl, server-to-server)
          if (!origin) {
            return callback(null, true);
          }

          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }

          // Origin not in allowlist — reject by passing false (no CORS headers emitted)
          return callback(null, false);
        },
    methods: ["GET", "HEAD", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 86400,
  });
}
