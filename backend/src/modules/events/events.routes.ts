import { Router } from "express";
import { EventNormalizer } from "./normalizers/index.js";
import { success } from "../../shared/http/response.js";

export function createEventsRouter() {
  const router = Router();

  router.get("/types", (_req, res) => {
    success(res, EventNormalizer.registeredTypes());
  });

  return router;
}
