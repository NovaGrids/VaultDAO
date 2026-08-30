/**
 * Server-Sent Events (SSE) broadcaster.
 *
 * Lightweight, read-only alternative to the WebSocket server for event
 * consumers (dashboards, monitoring tools) that don't need bidirectional
 * communication and shouldn't have to hold a persistent WebSocket handshake
 * open just to watch a stream of contract events.
 */

import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { createLogger } from "../../../shared/logging/logger.js";
import type { ContractEvent } from "../events.types.js";

const logger = createLogger("sse-broadcaster");

/** How often to write a comment line to keep idle connections/proxies alive. */
const KEEPALIVE_INTERVAL_MS = 15_000;

interface SseClient {
  id: string;
  res: Response;
  /** Normalized topic patterns this client filters on. Empty = all events. */
  topics: Set<string>;
}

/**
 * Normalizes a topic the same way the WebSocket server does, so a filter
 * like `proposal_created` behaves identically on both channels.
 */
function normalizeTopic(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.includes(":") ? trimmed : `notification:events:${trimmed.toUpperCase()}`;
}

function parseTopics(topicParam: string | undefined): Set<string> {
  if (!topicParam) return new Set();
  return new Set(
    topicParam
      .split(",")
      .map((t) => normalizeTopic(t))
      .filter((t) => t.length > 0),
  );
}

export class EventSseBroadcaster {
  private clients: Map<string, SseClient> = new Map();
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Registers a new SSE client on the given response, writes the SSE
   * preamble, and starts streaming matching events to it until the
   * connection closes.
   */
  addClient(res: Response, topicParam?: string): string {
    const id = randomUUID();
    const topics = parseTopics(topicParam);

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (e.g. nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 5000\n\n");

    this.clients.set(id, { id, res, topics });
    this.ensureKeepAlive();
    logger.info("sse client connected", { clientId: id, topics: Array.from(topics) });

    res.on("close", () => {
      this.removeClient(id);
    });

    return id;
  }

  removeClient(id: string): void {
    if (this.clients.delete(id)) {
      logger.info("sse client disconnected", { clientId: id });
    }
    if (this.clients.size === 0 && this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Sends a contract event to every client whose topic filter matches (or
   * that has no filter). Mirrors EventWebSocketServer.broadcastEvent's topic
   * derivation and matching rules for behavioral parity between channels.
   */
  broadcast(event: ContractEvent): number {
    const eventType = event.topic[0];
    const notificationTopic = `notification:events:${String(eventType).toUpperCase()}`;

    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch (err) {
      logger.warn("failed to serialize event for sse broadcast", {
        eventId: event.id,
        err,
      });
      return 0;
    }

    const frame = `event: ${String(eventType).toLowerCase()}\ndata: ${payload}\n\n`;

    let count = 0;
    for (const client of this.clients.values()) {
      if (client.topics.size > 0 && !this.matches(client.topics, notificationTopic)) {
        continue;
      }
      try {
        client.res.write(frame);
        count++;
      } catch (err) {
        logger.warn("failed to write sse event", {
          clientId: client.id,
          eventId: event.id,
          err,
        });
      }
    }

    if (count > 0) {
      logger.info(`broadcasted event ${event.id} to ${count} sse clients`);
    }
    return count;
  }

  private matches(topics: Set<string>, notificationTopic: string): boolean {
    for (const pattern of topics) {
      if (pattern.endsWith("*")) {
        if (notificationTopic.startsWith(pattern.slice(0, -1))) return true;
      } else if (pattern === notificationTopic) {
        return true;
      }
    }
    return false;
  }

  private ensureKeepAlive(): void {
    if (this.keepAliveInterval) return;
    this.keepAliveInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(": keep-alive\n\n");
        } catch {
          this.removeClient(client.id);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  public getActiveConnectionCount(): number {
    return this.clients.size;
  }

  public stop(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        // ignore — connection may already be closed
      }
    }
    this.clients.clear();
  }
}
