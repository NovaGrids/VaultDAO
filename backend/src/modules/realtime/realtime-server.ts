import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { createLogger } from "../../shared/logging/logger.js";
import {
  createRealtimeTopic,
  SubscriptionRegistry,
  createTopicBroadcaster,
  type RealtimeTopic,
} from "./subscriptions/index.js";
import type {
  RealtimeConnection,
  RealtimeConnectionLifecycleHooks,
  RealtimeEnvelope,
} from "./types.js";

const logger = createLogger("realtime-server");

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_DEADLINE_MS = 60_000; // dead if no pong within 2 ticks

// ---------------------------------------------------------------------------
// Internal connection wrapper
// ---------------------------------------------------------------------------

interface LiveConnection extends RealtimeConnection {
  ws: WebSocket;
  lastPong: number;
}

// ---------------------------------------------------------------------------
// RealtimeServer
// ---------------------------------------------------------------------------

export class RealtimeServer {
  private readonly connections = new Map<string, LiveConnection>();
  private readonly subscriptions = new SubscriptionRegistry();
  private readonly broadcaster = createTopicBroadcaster(
    this.subscriptions,
    (clientId, message) => this.deliver(clientId, message),
  );
  private readonly hooks: RealtimeConnectionLifecycleHooks;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(hooks: RealtimeConnectionLifecycleHooks = {}) {
    this.hooks = hooks;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  public start(server: Server): void {
    if (this.started) {
      logger.warn("realtime server already started");
      return;
    }

    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));

    this.heartbeatTimer = setInterval(
      () => this.runHeartbeat(),
      HEARTBEAT_INTERVAL_MS,
    );

    this.started = true;
    logger.info("realtime server started");
  }

  public stop(): void {
    if (!this.started) return;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const id of Array.from(this.connections.keys())) {
      this.unregisterConnection(id, "server shutdown");
    }

    this.wss?.close();
    this.wss = null;
    this.started = false;
    logger.info("realtime server stopped");
  }

  // ---------------------------------------------------------------------------
  // Connection handling
  // ---------------------------------------------------------------------------

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Auth via ?token= query param
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");
    const apiKey = process.env["API_KEY"];

    if (apiKey && token !== apiKey) {
      ws.close(4401, "Unauthorized");
      logger.warn("rejected unauthenticated realtime connection");
      return;
    }

    const connectionId = randomUUID();
    const conn: LiveConnection = {
      id: connectionId,
      ws,
      lastPong: Date.now(),
      send: (msg) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(msg));
          } catch (err) {
            logger.warn("send failed", { connectionId, err });
          }
        }
      },
      close: (code, reason) => ws.close(code, reason),
    };

    this.connections.set(connectionId, conn);
    this.hooks.onConnected?.(connectionId);

    // Send hello
    conn.send({
      type: "hello",
      ts: new Date().toISOString(),
      payload: { connectionId, status: "connected" },
    });

    ws.on("pong", () => {
      conn.lastPong = Date.now();
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(connectionId, msg);
      } catch {
        logger.warn("unparseable message", { connectionId });
      }
    });

    ws.on("close", () =>
      this.unregisterConnection(connectionId, "client disconnected"),
    );
    ws.on("error", (err) => {
      logger.error("ws error", { connectionId, err });
      this.unregisterConnection(connectionId, "error");
    });

    logger.info("connection registered", { connectionId });
  }

  private handleMessage(connectionId: string, msg: any): void {
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "subscribe": {
        const topic = this.parseTopic(msg.topic);
        if (!topic) return;
        const added = this.subscribe(connectionId, topic);
        if (added) {
          logger.info("subscribed", { connectionId, topic });
        }
        break;
      }
      case "unsubscribe": {
        const topic = this.parseTopic(msg.topic);
        if (!topic) return;
        this.unsubscribe(connectionId, topic);
        break;
      }
    }
  }

  private parseTopic(raw: unknown): RealtimeTopic | null {
    if (typeof raw !== "string") return null;
    // Accept "proposal:123" → "proposal.123" or already-namespaced "proposal.123"
    const normalized = raw.includes(":") ? raw.replace(":", ".") : raw;
    try {
      const [ns, ...rest] = normalized.split(".");
      return createRealtimeTopic(ns as any, rest.join("."));
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Subscription API
  // ---------------------------------------------------------------------------

  public subscribe(connectionId: string, topic: RealtimeTopic): boolean {
    if (!this.connections.has(connectionId)) return false;
    const added = this.subscriptions.subscribe(connectionId, topic);
    if (!added) return false;

    this.hooks.onSubscribed?.(connectionId, topic);
    this.deliver(connectionId, {
      type: "subscribed",
      topic,
      ts: new Date().toISOString(),
      payload: { topic },
    });
    return true;
  }

  public unsubscribe(connectionId: string, topic: RealtimeTopic): boolean {
    const removed = this.subscriptions.unsubscribe(connectionId, topic);
    if (!removed) return false;

    this.hooks.onUnsubscribed?.(connectionId, topic);
    this.deliver(connectionId, {
      type: "unsubscribed",
      topic,
      ts: new Date().toISOString(),
      payload: { topic },
    });
    return true;
  }

  public unregisterConnection(
    connectionId: string,
    reason = "client disconnected",
  ): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    this.subscriptions.unsubscribeAll(connectionId);
    this.connections.delete(connectionId);
    this.hooks.onDisconnected?.(connectionId);
    conn.close?.(1000, reason);
    logger.info("connection unregistered", { connectionId, reason });
  }

  // ---------------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------------

  /**
   * Broadcast a payload to all subscribers of a topic.
   * Topic can be given as a RealtimeTopic string ("proposal.123") or
   * the colon-separated shorthand ("proposal:123").
   */
  public broadcast(topic: RealtimeTopic, payload: unknown): number {
    return this.broadcaster.broadcast(topic, {
      type: "event",
      topic,
      payload,
      ts: new Date().toISOString(),
    });
  }

  /**
   * Convenience: broadcast a proposal activity record to both
   * proposal.<id> and proposal.<contractId> rooms.
   */
  public broadcastProposalActivity(record: {
    proposalId: string;
    type: string;
    metadata: { contractId: string };
    data: unknown;
  }): void {
    const proposalTopic = createRealtimeTopic("proposal", record.proposalId);
    const contractTopic = createRealtimeTopic(
      "proposal",
      `contract-${record.metadata.contractId}`,
    );

    const payload = {
      proposalId: record.proposalId,
      status: record.type,
      contractId: record.metadata.contractId,
      data: record.data,
    };

    this.broadcast(proposalTopic, payload);
    this.broadcast(contractTopic, payload);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private runHeartbeat(): void {
    const deadline = Date.now() - HEARTBEAT_DEADLINE_MS;
    for (const [id, conn] of this.connections) {
      if (conn.lastPong < deadline) {
        logger.warn("terminating dead connection", { connectionId: id });
        conn.ws.terminate();
        this.unregisterConnection(id, "heartbeat timeout");
        continue;
      }
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.ping();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private deliver(connectionId: string, message: RealtimeEnvelope): void {
    this.connections.get(connectionId)?.send(message);
  }

  public getConnectionCount(): number {
    return this.connections.size;
  }

  public getSubscriptions(connectionId: string): ReadonlySet<RealtimeTopic> {
    return this.subscriptions.getTopics(connectionId);
  }

  public createTopic(
    namespace: "proposal" | "activity" | "system" | "notification" | "custom",
    key: string,
  ): RealtimeTopic {
    return createRealtimeTopic(namespace, key);
  }
}
