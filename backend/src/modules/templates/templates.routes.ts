/**
 * Backend catalog API for vault policy templates (#2081).
 *
 * Routes:
 *   GET  /api/v1/templates            — list all templates (optional ?preset= filter)
 *   GET  /api/v1/templates/:id        — get one template with constraints
 *   POST /api/v1/templates/:id/validate — server-side pre-deploy validation
 *
 * All official presets are built into the binary (template.presets.ts).
 * Community templates can be added by calling `registerTemplate()` before
 * mounting this router.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  OFFICIAL_PRESETS,
  listPresets,
  getPreset,
} from "./template.presets.js";
import { validateDeployParams } from "./template.validator.js";
import type {
  VaultTemplateRecord,
  TemplateSummary,
  TemplateDetailResponse,
  ValidateTemplateRequest,
  ValidateTemplateResponse,
  TemplatePreset,
} from "./template.types.js";

// ---------------------------------------------------------------------------
// In-process community template registry
// ---------------------------------------------------------------------------

const communityTemplates = new Map<string, VaultTemplateRecord>(OFFICIAL_PRESETS);

/**
 * Register an additional template at runtime (e.g. loaded from a config file).
 * Throws if the id is already taken by an official preset.
 */
export function registerTemplate(template: VaultTemplateRecord): void {
  if (OFFICIAL_PRESETS.has(template.id)) {
    throw new Error(
      `Template id "${template.id}" is reserved for an official preset and cannot be overridden.`
    );
  }
  communityTemplates.set(template.id, template);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSummary(t: VaultTemplateRecord): TemplateSummary {
  const {
    minBaseSpendingLimit: _min,
    maxBaseSpendingLimit: _max,
    minSigners: _minS,
    maxSigners: _maxS,
    ...rest
  } = t;
  return rest;
}

function toDetail(t: VaultTemplateRecord): TemplateDetailResponse {
  return {
    ...toSummary(t),
    constraints: {
      minBaseSpendingLimit: t.minBaseSpendingLimit.toString(),
      maxBaseSpendingLimit: t.maxBaseSpendingLimit.toString(),
      minSigners: t.minSigners,
      maxSigners: t.maxSigners,
    },
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createTemplatesRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /api/v1/templates
  // -------------------------------------------------------------------------
  router.get("/", (req: Request, res: Response) => {
    const presetFilter = req.query["preset"] as TemplatePreset | undefined;

    let templates = [...communityTemplates.values()];
    if (presetFilter) {
      templates = templates.filter((t) => t.preset === presetFilter);
    }

    success(res, templates.map(toSummary));
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/templates/:id
  // -------------------------------------------------------------------------
  router.get("/:id", (req: Request, res: Response) => {
    const id = String(req.params["id"] ?? "");
    const template = communityTemplates.get(id);
    if (!template) {
      error(res, {
        message: `Template "${id}" not found`,
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    success(res, toDetail(template));
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/templates/:id/validate
  //
  // Body: { baseSpendingLimit: string, signerCount: number }
  //
  // Returns 200 { valid, errors, preview? } regardless of validity —
  // the caller reads `valid` to decide whether to proceed.
  // Returns 400 only if the request body itself is malformed.
  // -------------------------------------------------------------------------
  router.post("/:id/validate", (req: Request, res: Response) => {
    const id = String(req.params["id"] ?? "");
    const template = communityTemplates.get(id);
    if (!template) {
      error(res, {
        message: `Template "${id}" not found`,
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }

    const body = req.body as Partial<ValidateTemplateRequest>;

    if (!body.baseSpendingLimit || typeof body.signerCount !== "number") {
      error(res, {
        message: "Request body must contain baseSpendingLimit (string) and signerCount (number)",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    let baseSpendingLimit: bigint;
    try {
      baseSpendingLimit = BigInt(body.baseSpendingLimit);
    } catch {
      error(res, {
        message: `baseSpendingLimit "${body.baseSpendingLimit}" is not a valid integer`,
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const result = validateDeployParams({
      template,
      baseSpendingLimit,
      signerCount: body.signerCount,
    });

    const response: ValidateTemplateResponse = {
      valid: result.valid,
      errors: result.errors,
    };

    if (result.valid && result.preview) {
      response.preview = {
        threshold: result.preview.threshold,
        dailyLimit: result.preview.dailyLimit.toString(),
        weeklyLimit: result.preview.weeklyLimit.toString(),
        timelockThreshold: result.preview.timelockThreshold.toString(),
      };
    }

    success(res, response);
  });

  return router;
}
