import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { createLogger } from "../../shared/logging/logger.js";
import type { ContractEvent } from "../events/events.types.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";

const logger = createLogger("websocket-server");

// ---------------------------------------------------------------------------
// Heartbeat constants
// ---------------------------------------------------------------------------

/** How often to send a PING to each connected client. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Base pong deadline per round-trip.  If no pong arrives within this many ms
 * of a ping being sent the miss counter is incremented.
 */
const HEARTBEAT_BASE_TIMEOUT_MS = 10_000;

/** Maximum pong deadline when RTT is very high. */
const HEARTBEAT_MAX_TIMEOUT_MS = 30_000;

/** Close the connection after this many consecutive missed pongs. */
const HEARTBEAT_MAX_MISSED = 2;

/** EWMA smoothing factor for RTT.  Closer to 1 = more weight on recent samples. */
const RTT_EWMA_ALPHA = 0.2;

// ---------------------------------------------------------------------------
// Heartbeat metric names (exported so callers can register/query them)
// ---------------------------------------------------------------------------

export const WS_METRIC_PINGS_SENT = "ws_heartbeat_pings_sent_total";
export const WS_METRIC_PONGS_RECEIVED = "ws_heartbeat_pongs_received_total";
export const WS_METRIC_TIMEOUTS = "ws_heartbeat_timeouts_total";
export const WS_METRIC_RTT_MS = "ws_heartbeat_rtt_ms";

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

/**
 * Connecting    – TCP/WS handshake complete; awaiting authentication.
 * Authenticated – Client provided a valid token (either via query-param at
 *                 connection time or via an explicit "authenticate" message).
 * Subscribed    – Client has at least one active topic subscription.
 *
 * Valid transitions:
 *   Connecting    → Authenticated  (on valid auth)
 *   Authenticated → Subscribed     (on first subscribe)
 *   Subscribed    → Authenticated  (on unsubscribe all)
 *
 * Any message received while the connection is in an unexpected state triggers
 * an "invalid_transition" event and a 1008 close (policy violation).
 */
export type ConnectionState = "connecting" | "authenticated" | "subscribed";

/** Close code defined by RFC 6455 §7.4 – "violated policy". */
export const WS_CLOSE_POLICY_VIOLATION = 1008;

// ---------------------------------------------------------------------------
// Per-connection heartbeat state
// ---------------------------------------------------------------------------

interface HeartbeatStats {
  /** Number of consecutive pings sent without a pong response. */
  missedPings: number;
  /** Timestamp (ms) when the last ping was sent; 0 if none yet. */
  lastPingAt: number;
  /**
   * Exponentially-weighted moving average of round-trip time in ms.
   * Starts at 0 (unsampled).
   */
  smoothedRtt: number;
  /**
   * Effective pong deadline for this connection in ms.  Starts at
   * HEARTBEAT_BASE_TIMEOUT_MS and grows with smoothedRtt up to
   * HEARTBEAT_MAX_TIMEOUT_MS.
   */
  adaptiveTimeoutMs: number;
}

interface ClientSubscription {
  connectionId: string;
  subscriptions: Set<string>;
  /** room IDs this connection has joined (e.g. "proposal:123", "contract:ABC") */
  rooms: Set<string>;
  /** Current state in the connection lifecycle machine. */
  state: ConnectionState;
  /** Heartbeat tracking state. */
  heartbeat: HeartbeatStats;
}

// ---------------------------------------------------------------------------
// Event types emitted by EventWebSocketServer
// ---------------------------------------------------------------------------

export interface InvalidTransitionEvent {
  connectionId: string;
  currentState: ConnectionState;
  attemptedAction: string;
}

export interface HeartbeatEvent {
  connectionId: string;
  /** Round-trip latency of this ping/pong in ms. */
  latencyMs: number;
  /** Current consecutive missed-ping count (0 after a successful pong). */
  missedPings: number;
  /** Current adaptive pong deadline in ms. */
  adaptiveTimeoutMs: number;
}

export declare interface EventWebSocketServer {
  /** Emitted whenever a client sends a message that is invalid for its current state. */
  on(
    event: "invalid_transition",
    listener: (e: InvalidTransitionEvent) => void,
  ): this;
  emit(event: "invalid_transition", e: InvalidTransitionEvent): boolean;

  /** Emitted on each successful heartbeat round-trip. */
  on(event: "heartbeat", listener: (e: HeartbeatEvent) => void): this;
  emit(event: "heartbeat", e: HeartbeatEvent): boolean;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class EventWebSocketServer extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientSubscription> = new Map();
  /** room → set of WebSocket connections */
  private rooms: Map<string, Set<WebSocket>> = new Map();
  private readonly maxSubscriptionsPerClient: number;

  constructor(server: Server, maxSubscriptionsPerClient = 100) {
    this.maxSubscriptionsPerClient = maxSubscriptionsPerClient;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly metrics: MetricsRegistry | null;

  constructor(server: Server, metrics?: MetricsRegistry) {
    super();
    this.metrics = metrics ?? null;
    if (this.metrics) {
      this.registerMetrics(this.metrics);
    }
    this.wss = new WebSocketServer({ server });
    this.init();
  }

  // ---------------------------------------------------------------------------
  // Metric registration
  // ---------------------------------------------------------------------------

  private registerMetrics(registry: MetricsRegistry): void {
    registry.register(
      WS_METRIC_PINGS_SENT,
      "Total WebSocket PING frames sent to clients",
      "counter",
    );
    registry.register(
      WS_METRIC_PONGS_RECEIVED,
      "Total WebSocket PONG frames received from clients",
      "counter",
    );
    registry.register(
      WS_METRIC_TIMEOUTS,
      "Total WebSocket connections closed due to heartbeat timeout",
      "counter",
    );
    registry.registerHistogram(
      WS_METRIC_RTT_MS,
      "WebSocket heartbeat round-trip time in milliseconds",
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    );
  }

  // ---------------------------------------------------------------------------
  // Room management
  // ---------------------------------------------------------------------------

  joinRoom(connectionId: string, roomId: string): boolean {
    const ws = this.findWs(connectionId);
    if (!ws) return false;

    const sub = this.clients.get(ws)!;
    if (sub.rooms.has(roomId)) return false;

    sub.rooms.add(roomId);
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(ws);
    logger.info("joined room", { connectionId, roomId });
    return true;
  }

  leaveRoom(connectionId: string, roomId: string): boolean {
    const ws = this.findWs(connectionId);
    if (!ws) return false;

    const sub = this.clients.get(ws)!;
    if (!sub.rooms.has(roomId)) return false;

    sub.rooms.delete(roomId);
    this.rooms.get(roomId)?.delete(ws);
    if (this.rooms.get(roomId)?.size === 0) this.rooms.delete(roomId);
    logger.info("left room", { connectionId, roomId });
    return true;
  }

  broadcastToRoom(roomId: string, event: unknown): number {
    const members = this.rooms.get(roomId);
    if (!members || members.size === 0) return 0;

    let message: string;
    try {
      message = JSON.stringify({
        type: "room_event",
        room: roomId,
        payload: event,
      });
    } catch {
      logger.warn("failed to serialize room event", { roomId });
      return 0;
    }

    let count = 0;
    for (const ws of members) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(message);
        count++;
      } catch (err) {
        const sub = this.clients.get(ws);
        logger.warn("failed to send room event", {
          connectionId: sub?.connectionId,
          roomId,
          err,
        });
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  private init() {
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("token");
      const apiKey = process.env["API_KEY"];

      // If an API key is configured and the query-param token is wrong, reject
      // immediately — this is a hard auth failure, not a state transition.
      if (apiKey && token !== apiKey) {
        ws.close(4401, "Unauthorized");
        logger.warn("rejected unauthenticated websocket connection");
        return;
      }

      const connectionId = randomUUID();
      logger.info("client connected", { connectionId });

      // If a valid token was supplied at connect time (or no API key is
      // configured) the client is immediately authenticated.
      const initialState: ConnectionState =
        !apiKey || token === apiKey ? "authenticated" : "connecting";

      this.clients.set(ws, {
        connectionId,
        subscriptions: new Set(),
        rooms: new Set(),
        state: initialState,
        heartbeat: {
          missedPings: 0,
          lastPingAt: 0,
          smoothedRtt: 0,
          adaptiveTimeoutMs: HEARTBEAT_BASE_TIMEOUT_MS,
        },
      });

      ws.on("pong", () => {
        this.handlePong(ws);
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message, connectionId);
        } catch (error) {
          logger.error("failed to parse client message", {
            connectionId,
            error,
          });
        }
      });

      ws.on("close", () => {
        this.cleanupConnection(ws, connectionId);
      });

      ws.on("error", (error: Error) => {
        logger.error("websocket error", { connectionId, error });
        this.cleanupConnection(ws, connectionId);
      });
    });

    // Adaptive heartbeat loop
    this.heartbeatInterval = setInterval(() => {
      this.runHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.wss.on("close", () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Heartbeat implementation
  // ---------------------------------------------------------------------------

  /**
   * Called on every heartbeat tick (every HEARTBEAT_INTERVAL_MS).
   *
   * For each open connection:
   *   1. If a ping is outstanding and has exceeded the adaptive timeout,
   *      count it as a miss.  After HEARTBEAT_MAX_MISSED misses, terminate.
   *   2. Otherwise send a ping and record the timestamp.
   */
  private runHeartbeat(): void {
    const now = Date.now();

    for (const [ws, sub] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      const hb = sub.heartbeat;

      // Check whether the previous ping timed out
      if (hb.lastPingAt > 0) {
        const elapsed = now - hb.lastPingAt;
        if (elapsed > hb.adaptiveTimeoutMs) {
          // No pong arrived within the adaptive window — count as a miss
          hb.missedPings += 1;
          logger.warn("heartbeat miss", {
            connectionId: sub.connectionId,
            missedPings: hb.missedPings,
            elapsedMs: elapsed,
            adaptiveTimeoutMs: hb.adaptiveTimeoutMs,
          });

          if (hb.missedPings >= HEARTBEAT_MAX_MISSED) {
            logger.warn("terminating zombie connection", {
              connectionId: sub.connectionId,
              missedPings: hb.missedPings,
            });
            this.metrics?.incrementCounter(WS_METRIC_TIMEOUTS);
            ws.terminate();
            // cleanupConnection will be called from the close event
            continue;
          }
        }
      }

      // Send next ping and record timestamp
      try {
        ws.ping();
        hb.lastPingAt = Date.now();
        this.metrics?.incrementCounter(WS_METRIC_PINGS_SENT);
      } catch (err) {
        logger.warn("failed to send ping", {
          connectionId: sub.connectionId,
          err,
        });
      }
    }
  }

  /**
   * Called whenever a PONG frame arrives from a client.
   * Updates the EWMA RTT and resets the miss counter.
   * Emits a 'heartbeat' event and records metrics.
   */
  private handlePong(ws: WebSocket): void {
    const sub = this.clients.get(ws);
    if (!sub) return;

    const hb = sub.heartbeat;
    const now = Date.now();

    // Calculate RTT only if we have a pending ping timestamp
    let latencyMs = 0;
    if (hb.lastPingAt > 0) {
      latencyMs = now - hb.lastPingAt;

      // Update EWMA — first sample seeds the average directly
      if (hb.smoothedRtt === 0) {
        hb.smoothedRtt = latencyMs;
      } else {
        hb.smoothedRtt =
          RTT_EWMA_ALPHA * latencyMs +
          (1 - RTT_EWMA_ALPHA) * hb.smoothedRtt;
      }

      // Recalculate adaptive timeout:
      //   base + smoothedRtt * 2, clamped to [base, max]
      //   The x2 multiplier gives a comfortable buffer above the observed RTT.
      const proposed = HEARTBEAT_BASE_TIMEOUT_MS + hb.smoothedRtt * 2;
      hb.adaptiveTimeoutMs = Math.min(
        Math.max(proposed, HEARTBEAT_BASE_TIMEOUT_MS),
        HEARTBEAT_MAX_TIMEOUT_MS,
      );

      this.metrics?.observeHistogram(WS_METRIC_RTT_MS, latencyMs);
    }

    // Reset miss counter and clear the pending ping timestamp
    hb.missedPings = 0;
    hb.lastPingAt = 0;

    this.metrics?.incrementCounter(WS_METRIC_PONGS_RECEIVED);

    const heartbeatEvent: HeartbeatEvent = {
      connectionId: sub.connectionId,
      latencyMs,
      missedPings: hb.missedPings,
      adaptiveTimeoutMs: hb.adaptiveTimeoutMs,
    };

    logger.debug("heartbeat pong received", heartbeatEvent);
    this.emit("heartbeat", heartbeatEvent);
  }

  // ---------------------------------------------------------------------------
  // Message routing with state validation
  // ---------------------------------------------------------------------------

  private handleMessage(ws: WebSocket, message: any, connectionId: string) {
    const sub = this.clients.get(ws);
    if (!sub) return;

    const { type } = message ?? {};

    // ------------------------------------------------------------------
    // Explicit authentication message
    // ------------------------------------------------------------------
    if (type === "authenticate") {
      this.handleAuthenticate(ws, message, sub);
      return;
    }

    // ------------------------------------------------------------------
    // All other message types require at least "authenticated" state.
    // ------------------------------------------------------------------
    if (sub.state === "connecting") {
      this.rejectInvalidTransition(ws, sub, type ?? "unknown");
      return;
    }

    // ------------------------------------------------------------------
    // Route to specific handlers
    // ------------------------------------------------------------------
    if (type === "subscribe") {
      this.handleSubscribe(ws, message, connectionId);
    } else if (type === "unsubscribe") {
      this.handleUnsubscribe(ws, message, connectionId);
    } else if (type === "subscriptions") {
      ws.send(
        JSON.stringify({
          type: "subscriptions",
          topics: Array.from(sub.subscriptions),
        }),
      );
    } else if (type === "join") {
      // join/leave require Subscribed state
      if (sub.state !== "subscribed") {
        this.rejectInvalidTransition(ws, sub, type);
        return;
      }
      const roomId: string = message.room;
      if (roomId) {
        this.joinRoom(connectionId, roomId);
        ws.send(JSON.stringify({ type: "joined", room: roomId }));
      }
    } else if (type === "leave") {
      if (sub.state !== "subscribed") {
        this.rejectInvalidTransition(ws, sub, type);
        return;
      }
      const roomId: string = message.room;
      if (roomId) {
        this.leaveRoom(connectionId, roomId);
        ws.send(JSON.stringify({ type: "left", room: roomId }));
      }
    }
  }

  /**
   * Handle an explicit "authenticate" message.
   * Only valid in the "connecting" state.  Clients that are already
   * authenticated receive an error but are NOT closed.
   */
  private handleAuthenticate(
    ws: WebSocket,
    message: any,
    sub: ClientSubscription,
  ) {
    if (sub.state !== "connecting") {
      // Already authenticated — benign no-op with an informational error.
      ws.send(
        JSON.stringify({
          type: "error",
          code: "ALREADY_AUTHENTICATED",
          message: "Connection is already authenticated",
        }),
      );
      return;
    }

    const apiKey = process.env["API_KEY"];
    const token: string | undefined = message.token;

    if (apiKey && token !== apiKey) {
      logger.warn("authenticate: bad token", {
        connectionId: sub.connectionId,
      });
      ws.close(WS_CLOSE_POLICY_VIOLATION, "Policy Violation: invalid token");
      return;
    }

    sub.state = "authenticated";
    logger.info("client authenticated via message", {
      connectionId: sub.connectionId,
    });
    ws.send(JSON.stringify({ type: "authenticated" }));
  }

  /**
   * Reject a message sent in the wrong state.
   * Emits an "invalid_transition" event, sends an error frame, then closes
   * with 1008 (Policy Violation).
   */
  private rejectInvalidTransition(
    ws: WebSocket,
    sub: ClientSubscription,
    attemptedAction: string,
  ) {
    const event: InvalidTransitionEvent = {
      connectionId: sub.connectionId,
      currentState: sub.state,
      attemptedAction,
    };

    logger.warn("invalid state transition", event);
    this.emit("invalid_transition", event);

    try {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_STATE",
          message: `Cannot perform '${attemptedAction}' while in state '${sub.state}'`,
        }),
      );
    } catch {
      // ignore — connection may already be closing
    }

    ws.close(
      WS_CLOSE_POLICY_VIOLATION,
      `Policy Violation: '${attemptedAction}' not allowed in state '${sub.state}'`,
    );
  }

  private cleanupConnection(ws: WebSocket, connectionId: string): void {
    const sub = this.clients.get(ws);
    if (!sub) return;

    // Remove from all rooms
    for (const roomId of sub.rooms) {
      this.rooms.get(roomId)?.delete(ws);
      if (this.rooms.get(roomId)?.size === 0) this.rooms.delete(roomId);
    }

    this.clients.delete(ws);
    logger.info("client disconnected", {
      connectionId: sub.connectionId ?? connectionId,
    });
  }

  private handleSubscribe(ws: WebSocket, message: any, connectionId: string) {
    const topics: string[] | undefined = Array.isArray(message.topics)
      ? message.topics
      : Array.isArray(message.payload?.eventTypes)
        ? message.payload.eventTypes
        : undefined;

    const sub = this.clients.get(ws);
    if (!sub) return;

    if (!topics || topics.length === 0) {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid topic format" }),
      );
      return;
    }

    for (const t of topics) {
      // normalize: accept legacy short names like 'proposal_executed' and full 'notification:events:FOO'
      let norm = t;
      if (!t.includes(":")) {
        norm = `notification:events:${t.toUpperCase()}`;
      }

      if (sub.subscriptions.size >= this.maxSubscriptionsPerClient) {
        const remaining = 0;
        ws.send(
          JSON.stringify({
            type: "error",
            code: "SUBSCRIPTION_LIMIT_REACHED",
            message: `Maximum ${this.maxSubscriptionsPerClient} topic subscriptions per connection`,
            limit: this.maxSubscriptionsPerClient,
            remaining,
          }),
        );
        break;
      }

      // validate pattern
      if (!/^notification:events:([A-Z0-9_*]+)$/.test(norm)) {
        ws.send(
          JSON.stringify({ type: "error", message: "Invalid topic format" }),
        );
        continue;
      }

      sub.subscriptions.add(norm);
    }

    // Transition to subscribed state once there is at least one subscription.
    if (sub.subscriptions.size > 0 && sub.state === "authenticated") {
      sub.state = "subscribed";
      logger.info("client moved to subscribed state", { connectionId });
    }

    logger.info("client subscribed", { connectionId, topics });
    this.clients.set(ws, sub);
    ws.send(JSON.stringify({ type: "subscribed", topics: topics }));
  }

  private handleUnsubscribe(
    ws: WebSocket,
    message: any,
    connectionId: string,
  ) {
    const topics: string[] | undefined = Array.isArray(message.topics)
      ? message.topics
      : undefined;
    const sub = this.clients.get(ws);
    if (!sub || !topics) {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid topic format" }),
      );
      return;
    }

    // Track state before removal for cleanup verification
    const before = new Set(sub.subscriptions);

    const removedTopics: string[] = [];
    const failedTopics: string[] = [];

    for (const t of topics) {
      let norm = t;
      if (!t.includes(":")) {
        norm = `notification:events:${t.toUpperCase()}`;
      }

      if (!before.has(norm)) {
        // Topic was not subscribed — nothing to remove
        continue;
      }

      sub.subscriptions.delete(norm);

      // Verify cleanup: topic must no longer be present
      if (sub.subscriptions.has(norm)) {
        failedTopics.push(norm);
        logger.warn("unsubscribe cleanup failed: topic still present after removal", {
          connectionId,
          topic: norm,
        });
      } else {
        removedTopics.push(norm);
      }
    }

    if (failedTopics.length > 0) {
      logger.error("unsubscribe incomplete: some topics were not cleaned up", {
        connectionId,
        failedTopics,
        remainingSubscriptions: Array.from(sub.subscriptions),
      });
    }

    // If all subscriptions have been removed, revert to authenticated state.
    if (sub.subscriptions.size === 0 && sub.state === "subscribed") {
      sub.state = "authenticated";
      logger.info("client reverted to authenticated state", {
        connectionId: sub.connectionId,
      });
    }

    this.clients.set(ws, sub);

    // Emit cleanup event with subscriber identity and affected topics
    ws.send(
      JSON.stringify({
        type: "unsubscribed",
        subscriber: connectionId,
        removedTopics,
        remainingTopics: Array.from(sub.subscriptions),
      }),
    );

    logger.info("client unsubscribed", {
      connectionId,
      removedTopics,
      remainingSubscriptions: sub.subscriptions.size,
    });
  }

  private findWs(connectionId: string): WebSocket | undefined {
    for (const [ws, sub] of this.clients) {
      if (sub.connectionId === connectionId) return ws;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Legacy broadcast (contract events)
  // ---------------------------------------------------------------------------

  public broadcastEvent(event: ContractEvent) {
    const eventType = event.topic[0];
    const _proposalId =
      event.topic[1] || (event.value && (event.value as any).proposal_id);
    void _proposalId;
    const notificationTopic = `notification:events:${String(eventType).toUpperCase()}`;

    let message: string;
    try {
      message = JSON.stringify({ type: "contract_event", payload: event });
    } catch (error) {
      logger.warn("failed to serialize event for broadcast", {
        eventId: event.id,
        error,
      });
      return;
    }

    let broadcastCount = 0;
    this.clients.forEach((sub, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Only deliver to authenticated or subscribed clients.
      if (sub.state === "connecting") return;

      // If no subscriptions, deliver all events (backward compatible)
      if (!sub.subscriptions || sub.subscriptions.size === 0) {
        try {
          ws.send(message);
          broadcastCount++;
        } catch (error) {
          logger.warn("failed to send event to client", {
            connectionId: sub.connectionId,
            eventId: event.id,
            error,
          });
        }
        return;
      }

      // Otherwise, check if any subscription matches notificationTopic
      let matched = false;
      for (const pattern of sub.subscriptions) {
        if (pattern.endsWith("*")) {
          const prefix = pattern.slice(0, -1);
          if (notificationTopic.startsWith(prefix)) matched = true;
        } else if (pattern === notificationTopic) {
          matched = true;
        }
        if (matched) break;
      }

      if (!matched) return;

      try {
        ws.send(message);
        broadcastCount++;
      } catch (error) {
        logger.warn("failed to send event to client", {
          connectionId: sub.connectionId,
          eventId: event.id,
          error,
        });
      }
    });

    if (broadcastCount > 0) {
      logger.info(`broadcasted event ${event.id} to ${broadcastCount} clients`);
    }
  }

  public stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.wss.close();
  }

  public getActiveConnectionCount(): number {
    return this.clients.size;
  }

  /** Expose the state of a connection (for testing). */
  public getConnectionState(connectionId: string): ConnectionState | undefined {
    const ws = this.findWs(connectionId);
    if (!ws) return undefined;
    return this.clients.get(ws)?.state;
  }

  /**
   * Expose heartbeat stats for a connection (for testing / introspection).
   * Returns a snapshot copy so callers cannot mutate internal state.
   */
  public getHeartbeatStats(connectionId: string): HeartbeatStats | undefined {
    const ws = this.findWs(connectionId);
    if (!ws) return undefined;
    const hb = this.clients.get(ws)?.heartbeat;
    if (!hb) return undefined;
    return { ...hb };
  }

  /**
   * Trigger one heartbeat tick immediately.
   * Intended for unit tests where we don't want to wait 30 seconds.
   */
  public tickHeartbeat(): void {
    this.runHeartbeat();
  }
}
