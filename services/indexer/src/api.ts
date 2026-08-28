/**
 * api.ts — Read-only HTTP API for the indexer.
 *
 * Endpoints (all public, no authentication):
 *
 *   GET /health
 *     → { status, lastLedger, headLedger, lag, lastError, lastErrorTime,
 *         consecutiveErrors, fetchAttempts, fetchFailures }
 *
 *   GET /claims?wallet=G…
 *     → { wallet: string, claims: ClaimRow[] }
 *
 *   GET /stats
 *     → { stats: StatsRow[] }
 *
 *   GET /recent?limit=20&page=1
 *     → { claims: ClaimRow[], limit: number, page: number }
 *
 * All responses are JSON.  No write endpoints exist.
 * No identity fields are stored, so all data here is public chain data.
 */

import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import type { Db } from "./db";
import type { Ingester } from "./ingester";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// Helper: wrap an async handler and forward errors to next()
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function buildApp(db: Db, ingester: Ingester): express.Application {
  const app = express();

  // Security: no body parsing (read-only), conservative headers.
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // ── GET /health ──────────────────────────────────────────────────────────
  // Exposes ingester lag so operators can alert when the indexer falls behind.
  //
  // status semantics:
  //   "ok"       — consecutiveErrors === 0
  //   "degraded" — last fetch failed but some succeeded before it
  //   "error"    — 3+ consecutive failures (stale data, indexer likely stalled)
  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      const lastLedger = await db.getLastLedger();
      const h = ingester.getHealth();

      let status: "ok" | "degraded" | "error";
      if (h.consecutiveErrors === 0) {
        status = "ok";
      } else if (h.consecutiveErrors < 3) {
        status = "degraded";
      } else {
        status = "error";
      }

      res.json({
        status,
        lastLedger,
        headLedger: h.headLedger,
        lag: h.lag,
        lastSuccessLedger: h.lastSuccessLedger,
        lastError: h.lastError,
        lastErrorTime: h.lastErrorTime,
        consecutiveErrors: h.consecutiveErrors,
        fetchAttempts: h.fetchAttempts,
        fetchFailures: h.fetchFailures,
      });
    })
  );

  // ── GET /claims?wallet=G… ────────────────────────────────────────────────
  app.get(
    "/claims",
    asyncHandler(async (req, res) => {
      const wallet = req.query["wallet"];
      if (typeof wallet !== "string" || wallet.trim() === "") {
        res.status(400).json({
          error: "wallet query parameter is required",
        });
        return;
      }

      const claims = await db.claimsByWallet(wallet.trim());
      res.json({ wallet: wallet.trim(), claims });
    })
  );

  // ── GET /stats ───────────────────────────────────────────────────────────
  app.get(
    "/stats",
    asyncHandler(async (_req, res) => {
      const stats = await db.stats();
      res.json({ stats });
    })
  );

  // ── GET /recent?limit=20&page=1 ──────────────────────────────────────────
  app.get(
    "/recent",
    asyncHandler(async (req, res) => {
      const rawLimit = parseInt(String(req.query["limit"] ?? DEFAULT_LIMIT), 10);
      const rawPage = parseInt(String(req.query["page"] ?? 1), 10);

      const limit = isNaN(rawLimit) || rawLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(rawLimit, MAX_LIMIT);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      const offset = (page - 1) * limit;

      const claims = await db.recent(limit, offset);
      res.json({ claims, limit, page });
    })
  );

  // ── 404 ──────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // ── Error handler ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[indexer/api] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
