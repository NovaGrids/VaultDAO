/**
 * ETag cache middleware for admin GET endpoints.
 *
 * Intercepts the response body, derives a strong ETag from its bytes, and
 * answers `If-None-Match` hits with 304 without re-rendering. The tag cache
 * is per-process and bounded, so it never grows with traffic; it only saves
 * payload transfer for repeated identical polls of slowly-changing config.
 */

import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

const MAX_CACHED_TAGS = 1024;

export function createEtagCacheMiddleware(): RequestHandler {
  const tags = new Map<string, string>();

  return (req, res, next) => {
    // Only cache idempotent reads.
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const key = `${req.originalUrl ?? req.url}`;

    // Stale-dropping LRU-lite: evict the oldest entry when the cap is hit.
    if (tags.size >= MAX_CACHED_TAGS) {
      const oldest = tags.keys().next().value;
      if (oldest !== undefined) tags.delete(oldest);
    }

    const etag = tags.get(key);
    if (etag !== undefined && req.headers["if-none-match"] === etag) {
      res.setHeader("ETag", etag);
      res.status(304).end();
      return;
    }

    const chunks: Buffer[] = [];
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      return originalWrite(chunk as never, ...(rest as never[]));
    }) as typeof res.write;

    res.end = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (Buffer.isBuffer(chunk)) chunks.push(chunk);

      const body = Buffer.concat(chunks);
      const computed = `"${createHash("sha256").update(body).digest("base64")}"`;
      tags.set(key, computed);
      res.setHeader("ETag", computed);

      if (req.headers["if-none-match"] === computed) {
        res.statusCode = 304;
        return originalEnd();
      }
      return originalEnd(chunk as never, ...(rest as never[]));
    }) as typeof res.end;

    next();
  };
}
