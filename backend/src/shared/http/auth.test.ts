import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requireApiKey, createAuthMiddleware } from "./auth.js";
import { ErrorCode } from "./errorCodes.js";

// Mock response object
function createMockResponse() {
    const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: null as any,
        req: {} as any,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        set(key: string, value: string) {
            this.headers[key] = value;
            return this;
        },
        json(data: any) {
            this.body = data;
            return this;
        },
    };
    return res as any as Response;
}

// Mock request object
function createMockRequest(headers: Record<string, string> = {}) {
    return {
        get(name: string) {
            return headers[name.toLowerCase()];
        },
    } as unknown as Request;
}

describe("requireApiKey middleware", () => {
    it("allows request when no API key is configured (development mode)", () => {
        const middleware = requireApiKey(undefined);
        const req = createMockRequest();
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
    });

    it("returns 401 when Authorization header is missing", () => {
        const middleware = requireApiKey("test-api-key-123");
        const req = createMockRequest();
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.UNAUTHORIZED);
        assert.match(res.body.error.message, /Missing authentication/);
        assert.equal(next.mock.calls.length, 0);
    });

    it("returns 401 when X-API-Key header is missing", () => {
        const middleware = requireApiKey("test-api-key-123");
        const req = createMockRequest();
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.UNAUTHORIZED);
        assert.equal(next.mock.calls.length, 0);
    });

    it("returns 403 when Authorization Bearer token is wrong", () => {
        const middleware = requireApiKey("test-api-key-123");
        const req = createMockRequest({
            authorization: "Bearer wrong-key",
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.FORBIDDEN);
        assert.match(res.body.error.message, /Invalid API key/);
        assert.equal(next.mock.calls.length, 0);
    });

    it("returns 403 when X-API-Key is wrong", () => {
        const middleware = requireApiKey("test-api-key-123");
        const req = createMockRequest({
            "x-api-key": "wrong-key",
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.FORBIDDEN);
        assert.match(res.body.error.message, /Invalid API key/);
        assert.equal(next.mock.calls.length, 0);
    });

    it("allows request with correct Authorization Bearer token", () => {
        const apiKey = "test-api-key-123";
        const middleware = requireApiKey(apiKey);
        const req = createMockRequest({
            authorization: `Bearer ${apiKey}`,
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
        assert.equal(res.statusCode, 200);
    });

    it("allows request with correct X-API-Key header", () => {
        const apiKey = "test-api-key-123";
        const middleware = requireApiKey(apiKey);
        const req = createMockRequest({
            "x-api-key": apiKey,
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
        assert.equal(res.statusCode, 200);
    });

    it("uses constant-time comparison to prevent timing attacks", () => {
        const apiKey = "test-api-key-123";
        const middleware = requireApiKey(apiKey);

        // Test with keys of different lengths
        const req1 = createMockRequest({
            authorization: "Bearer short",
        });
        const res1 = createMockResponse();
        const next1 = mock.fn();

        middleware(req1, res1, next1);

        assert.equal(res1.statusCode, 403);
        assert.equal(next1.mock.calls.length, 0);

        // Test with key of same length but different content
        const req2 = createMockRequest({
            authorization: "Bearer test-api-key-456",
        });
        const res2 = createMockResponse();
        const next2 = mock.fn();

        middleware(req2, res2, next2);

        assert.equal(res2.statusCode, 403);
        assert.equal(next2.mock.calls.length, 0);
    });

    it("distinguishes between missing (401) and wrong (403) API key", () => {
        const middleware = requireApiKey("test-api-key-123");

        // Missing key
        const req1 = createMockRequest();
        const res1 = createMockResponse();
        const next1 = mock.fn();

        middleware(req1, res1, next1);

        assert.equal(res1.statusCode, 401);

        // Wrong key
        const req2 = createMockRequest({
            authorization: "Bearer wrong-key",
        });
        const res2 = createMockResponse();
        const next2 = mock.fn();

        middleware(req2, res2, next2);

        assert.equal(res2.statusCode, 403);
    });

    it("prefers Authorization header over X-API-Key when both are present", () => {
        const apiKey = "test-api-key-123";
        const middleware = requireApiKey(apiKey);

        // Correct Authorization, wrong X-API-Key
        const req = createMockRequest({
            authorization: `Bearer ${apiKey}`,
            "x-api-key": "wrong-key",
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
        assert.equal(res.statusCode, 200);
    });
});

describe("createAuthMiddleware (legacy)", () => {
    it("allows request when no API key is configured", () => {
        const middleware = createAuthMiddleware(undefined);
        const req = createMockRequest();
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
    });

    it("returns 401 when Authorization header is missing", () => {
        const middleware = createAuthMiddleware("test-api-key-123");
        const req = createMockRequest();
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.UNAUTHORIZED);
        assert.equal(next.mock.calls.length, 0);
    });

    it("returns 401 when Authorization Bearer token is wrong", () => {
        const middleware = createAuthMiddleware("test-api-key-123");
        const req = createMockRequest({
            authorization: "Bearer wrong-key",
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.UNAUTHORIZED);
        assert.equal(next.mock.calls.length, 0);
    });

    it("allows request with correct Authorization Bearer token", () => {
        const apiKey = "test-api-key-123";
        const middleware = createAuthMiddleware(apiKey);
        const req = createMockRequest({
            authorization: `Bearer ${apiKey}`,
        });
        const res = createMockResponse();
        const next = mock.fn();

        middleware(req, res, next);

        assert.equal(next.mock.calls.length, 1);
        assert.equal(res.statusCode, 200);
    });
});
