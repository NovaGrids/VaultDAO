import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimitMiddleware } from "./rateLimit.js";
import express, { Request, Response } from "express";

test("Rate Limiter", async (t) => {
  await t.test("allows requests within limit", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 3,
    });

    const app = express();
    let callCount = 0;
    app.use(middleware);
    app.get("/", (_req, res) => {
      callCount++;
      res.json({ ok: true });
    });

    // Simulate 3 requests within limit
    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;
    const mockRes = {
      set: () => mockRes,
      json: () => {},
      status: () => mockRes,
    } as unknown as Response;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);

    assert.equal(nextCalled, 3, "First 3 requests should be allowed");
  });

  await t.test("blocks requests exceeding limit", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 2,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;

    const mockRes = {
      status: function (code: number): any {
        this.statusCode = code;
        return this;
      },
      set: (): any => mockRes,
      json: function (data: any): any {
        this.jsonData = data;
        return this;
      },
      statusCode: 0,
      jsonData: null,
    } as any;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    // First two requests allowed
    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);

    // Third request blocked
    middleware(mockReq, mockRes, next);

    assert.equal(
      (mockRes as any).statusCode,
      429,
      "Should return 429 for exceeded limit"
    );
    assert.equal(
      (mockRes as any).jsonData?.error?.code,
      "RATE_LIMIT_EXCEEDED"
    );
    assert.equal(nextCalled, 2, "Only first 2 requests should call next");
  });

  await t.test("resets limit after window expires", async () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 100, // 100ms window
      maxRequests: 1,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    const mockRes = {
      status: function () {
        return this;
      },
      set: () => mockRes,
      json: () => {},
    } as unknown as Response;

    // First request allowed
    middleware(mockReq, mockRes, next);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    middleware(mockReq, mockRes, next);

    assert.equal(nextCalled, 2, "Should allow requests after window expires");
  });

  await t.test("identifies clients by IP address", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 1,
    });

    const createMockReq = (ip: string) => ({
      headers: {},
      socket: { remoteAddress: ip },
      get: () => undefined,
    }) as unknown as Request;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    const mockRes = {
      status: function () {
        return this;
      },
      set: () => mockRes,
      json: () => {},
    } as unknown as Response;

    const req1 = createMockReq("192.168.1.1");
    const req2 = createMockReq("192.168.1.2");

    // First client hits limit
    middleware(req1, mockRes, next);

    // Second client should not be limited
    middleware(req2, mockRes, next);

    assert.equal(
      nextCalled,
      2,
      "Different IPs should have separate rate limits"
    );
  });
});
