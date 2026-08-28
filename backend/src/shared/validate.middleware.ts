import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodSchema } from "zod";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationErrorBody {
  error: "ValidationError";
  issues: ValidationIssue[];
}

/**
 * Where in the request the schema should be applied against.
 */
export type ValidationTarget = "body" | "query" | "params";

/**
 * Generic Express middleware factory that validates part of a request
 * (`body` by default) against a Zod schema.
 *
 * On success:
 * - For `body` and `params`, `req[target]` is replaced with the
 *   parsed/coerced value so downstream handlers can trust its shape.
 * - For `query`, Express 5 does not allow reassigning `req.query` (it is a
 *   getter-only property), and this codebase's controllers frequently parse
 *   `req.query` themselves afterwards — so the query object is left
 *   untouched. This middleware only acts as an early rejection gate for
 *   `query`; it does not normalize/coerce values in place.
 *
 * On failure, responds with `400 { error: "ValidationError", issues: [{ field, message }] }`
 * and does not call `next()`.
 */
export function validate(schema: ZodSchema, target: ValidationTarget = "body"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const body: ValidationErrorBody = {
        error: "ValidationError",
        issues: result.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join(".") : target,
          message: issue.message,
        })),
      };
      res.status(400).json(body);
      return;
    }

    if (target !== "query") {
      req[target] = result.data as never;
    }

    next();
  };
}
