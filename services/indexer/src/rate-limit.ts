/**
 * rate-limit.ts — Per-IP fixed-window rate limiter for the indexer HTTP API.
 *
 * Implements an in-memory counter per IP over a fixed time window.
 * When the threshold is reached, subsequent requests return:
 *   - HTTP 429 Too Many Requests
 *   - Retry-After: <seconds until window reset>
 *   - RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset headers
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  enabled?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

interface Bucket {
  count: number;
  windowEnd: number;
}

export class RateLimiter {
  private store = new Map<string, Bucket>();
  private windowMs: number;
  private max: number;
  private enabled: boolean;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.enabled = options.enabled ?? true;

    // Periodically sweep expired buckets to prevent memory accumulation.
    const interval = Math.max(this.windowMs, 60000);
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public extractIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0].trim();
      if (first) return first;
    } else if (Array.isArray(forwarded) && forwarded.length > 0) {
      const first = forwarded[0].split(",")[0].trim();
      if (first) return first;
    }

    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) {
      return realIp.trim();
    }

    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) {
      return cfIp.trim();
    }

    return req.ip || req.socket?.remoteAddress || "127.0.0.1";
  }

  public check(ip: string, now: number = Date.now()): RateLimitResult {
    if (!this.enabled) {
      return {
        allowed: true,
        limit: this.max,
        remaining: this.max,
        resetSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    const bucket = this.store.get(ip);
    if (!bucket || now >= bucket.windowEnd) {
      const windowEnd = now + this.windowMs;
      this.store.set(ip, { count: 1, windowEnd });
      return {
        allowed: true,
        limit: this.max,
        remaining: Math.max(0, this.max - 1),
        resetSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    bucket.count += 1;
    const resetSeconds = Math.max(1, Math.ceil((bucket.windowEnd - now) / 1000));
    const allowed = bucket.count <= this.max;
    const remaining = Math.max(0, this.max - bucket.count);

    return {
      allowed,
      limit: this.max,
      remaining,
      resetSeconds,
    };
  }

  public middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!this.enabled) {
        return next();
      }

      const ip = this.extractIp(req);
      const result = this.check(ip);

      res.setHeader("RateLimit-Limit", result.limit);
      res.setHeader("RateLimit-Remaining", result.remaining);
      res.setHeader("RateLimit-Reset", result.resetSeconds);

      if (!result.allowed) {
        res.setHeader("Retry-After", result.resetSeconds);
        res.status(429).json({
          error: "too many requests",
          retryAfter: result.resetSeconds,
        });
        return;
      }

      next();
    };
  }

  public cleanup(now: number = Date.now()): void {
    for (const [key, bucket] of this.store.entries()) {
      if (now >= bucket.windowEnd) {
        this.store.delete(key);
      }
    }
  }

  public reset(): void {
    this.store.clear();
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.store.clear();
  }
}
