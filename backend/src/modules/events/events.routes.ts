import { Router } from "express";
import { EventNormalizer } from "./normalizers/index.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { EventSseBroadcaster } from "./sse/sse.broadcaster.js";

export function createEventsRouter(sseBroadcaster?: EventSseBroadcaster) {
  const router = Router();

  router.get("/types", (_req, res) => {
    success(res, EventNormalizer.registeredTypes());
  });

  // Lightweight, read-only alternative to the WebSocket channel for event
  // consumers that just want to watch the stream (dashboards, monitoring
  // tools) without holding a persistent WebSocket connection open.
  // ?topic=proposal_created,proposal_executed filters to matching topics;
  // omitting it streams every contract event.
  router.get("/stream", (req, res) => {
    if (!sseBroadcaster) {
      error(res, {
        message: "SSE streaming is not available",
        status: 503,
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });
      return;
    }

    const topicParam =
      typeof req.query["topic"] === "string" ? req.query["topic"] : undefined;
    sseBroadcaster.addClient(res, topicParam);
  });

  return router;
}
