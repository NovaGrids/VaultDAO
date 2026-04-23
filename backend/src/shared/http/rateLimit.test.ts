import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import type { Request } from "express";
import { RateLimiter } from "./rateLimit.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_TIME = 1_000_000;
const WINDOW_MS = 1000;
const MAX_REQUESTS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalDateNow = Date.now;

function mockDate(ts: number): void {
  Date.now = () => ts;
}

function restoreDate(): void {
  Date.now = originalDateNow;
}

function makeReq(ip = "127.0.0.1"): Request {
  return { socket: { remoteAddress: ip } } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Shared limiter
// ---------------------------------------------------------------------------

const limiter = new RateLimiter({
  windowMs: WINDOW_MS,
  maxRequests: MAX_REQUESTS,
});

beforeEach(() => {
  limiter.reset();
  mockDate(BASE_TIME);
});

afterEach(() => {
  restoreDate();
});

// ---------------------------------------------------------------------------
// Requirement 1 – within-limit requests allowed
// ---------------------------------------------------------------------------

describe("Requirement 1 – within-limit requests allowed", () => {
  it("P1: within-limit calls are never blocked", () => {
    // Feature: rate-limiter-coverage, Property 1: Within-limit calls are never blocked
    // Validates: Requirements 1.1, 1.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        (maxRequests: number, ip: string) => {
          const localLimiter = new RateLimiter({
            windowMs: WINDOW_MS,
            maxRequests,
          });
          const req = makeReq(ip);
          for (let i = 0; i < maxRequests; i++) {
            assert.equal(localLimiter.isLimited(req), false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 2 – over-limit requests blocked
// ---------------------------------------------------------------------------

describe("Requirement 2 – over-limit requests blocked", () => {
  it("P2: over-limit calls are always blocked", () => {
    // Feature: rate-limiter-coverage, Property 2: Over-limit calls are always blocked
    // Validates: Requirements 2.1, 2.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        fc.integer({ min: 1, max: 5 }),
        (maxRequests: number, ip: string, k: number) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq(ip);
          // Exhaust the limit
          for (let i = 0; i < maxRequests; i++) {
            localLimiter.isLimited(req);
          }
          // Calls at positions maxRequests+1 … maxRequests+k must all return true
          for (let i = 0; i < k; i++) {
            assert.equal(localLimiter.isLimited(req), true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 3 – window reset
// ---------------------------------------------------------------------------

describe("Requirement 3 – window reset", () => {
  it("P3: window reset restores access and resets count", () => {
    // Feature: rate-limiter-coverage, Property 3: Window reset restores access and resets count
    // Validates: Requirements 3.1, 3.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: 0, max: 500 }),
        (maxRequests: number, ip: string, windowMs: number, extra: number) => {
          const localLimiter = new RateLimiter({ windowMs, maxRequests });
          const req = makeReq(ip);

          // Start at BASE_TIME and exhaust the limit
          mockDate(BASE_TIME);
          for (let i = 0; i < maxRequests; i++) {
            localLimiter.isLimited(req);
          }
          // Confirm the client is now blocked
          assert.equal(localLimiter.isLimited(req), true);

          // Advance time past the window
          mockDate(BASE_TIME + windowMs + extra);

          // Next call should open a new window → not limited
          assert.equal(localLimiter.isLimited(req), false);

          // The reset request counts as 1, so remaining = maxRequests - 1
          assert.equal(localLimiter.getRemaining(req), maxRequests - 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 4 – getRemaining()
// ---------------------------------------------------------------------------

describe("Requirement 4 – getRemaining()", () => {
  it("P4: getRemaining decrements with each request", () => {
    // Feature: rate-limiter-coverage, Property 4: getRemaining decrements with each request
    // Validates: Requirements 4.1, 4.2
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 20 })
          .chain((max: number) =>
            fc.tuple(fc.constant(max), fc.integer({ min: 0, max: max })),
          ),
        ([maxRequests, n]: [number, number]) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq("127.0.0.1");
          for (let i = 0; i < n; i++) {
            localLimiter.isLimited(req);
          }
          assert.equal(localLimiter.getRemaining(req), maxRequests - n);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("P5: getRemaining floors at zero", () => {
    // Feature: rate-limiter-coverage, Property 5: getRemaining floors at zero
    // Validates: Requirements 4.3
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        (maxRequests: number, k: number) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq("127.0.0.1");
          for (let i = 0; i < maxRequests + k; i++) {
            localLimiter.isLimited(req);
          }
          assert.equal(localLimiter.getRemaining(req), 0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 5 – getResetTime()
// ---------------------------------------------------------------------------

describe("Requirement 5 – getResetTime()", () => {
  it("P6: getResetTime equals window-start plus windowMs", () => {
    // Feature: rate-limiter-coverage, Property 6: getResetTime equals window-start plus windowMs
    // Validates: Requirements 5.1
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 100, max: 10000 }),
        (T: number, windowMs: number) => {
          const localLimiter = new RateLimiter({ windowMs, maxRequests: 10 });
          const req = makeReq("127.0.0.1");
          mockDate(T);
          localLimiter.isLimited(req);
          assert.equal(localLimiter.getResetTime(req), T + windowMs);
        },
      ),
      { numRuns: 100 },
    );
  });
});
