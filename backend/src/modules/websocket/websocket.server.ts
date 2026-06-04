import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { createLogger } from "../../shared/logging/logger.js";
import type { ContractEvent } from "../events/events.types.js";

const logger = createLogger("websocket-server");

interface ClientSubscription {
  connectionId: string;
  subscriptions: Set<string>;
  /** room IDs this connection has joined (e.g. "proposal:123", "contract:ABC") */
  rooms: Set<string>;
}

export class EventWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientSubscription> = new Map();
  /** room → set of WebSocket connections */
  private rooms: Map<string, Set<WebSocket>> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });
    this.init();
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
      // Auth via query param: ?token=<API_KEY>
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("token");
      const apiKey = process.env["API_KEY"];

      if (apiKey && token !== apiKey) {
        ws.close(4401, "Unauthorized");
        logger.warn("rejected unauthenticated websocket connection");
        return;
      }

      const connectionId = randomUUID();
      logger.info("client connected", { connectionId });

      (ws as any).isAlive = true;
      this.clients.set(ws, {
        connectionId,
        subscriptions: new Set(),
        rooms: new Set(),
      });

      ws.on("pong", () => {
        (ws as any).isAlive = true;
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "subscribe") {
            this.handleSubscribe(ws, message, connectionId);
          } else if (message.type === "unsubscribe") {
            this.handleUnsubscribe(ws, message, connectionId);
          } else if (message.type === "subscriptions") {
            const sub = this.clients.get(ws);
            ws.send(
              JSON.stringify({
                type: "subscriptions",
                topics: Array.from(sub?.subscriptions ?? []),
              }),
            );
          } else if (message.type === "join") {
            const roomId: string = message.room;
            if (roomId) {
              this.joinRoom(connectionId, roomId);
              ws.send(JSON.stringify({ type: "joined", room: roomId }));
            }
          } else if (message.type === "leave") {
            const roomId: string = message.room;
            if (roomId) {
              this.leaveRoom(connectionId, roomId);
              ws.send(JSON.stringify({ type: "left", room: roomId }));
            }
          }
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

    // Heartbeat: terminate connections that did not respond to the last ping
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on("close", () => {
      clearInterval(interval);
    });
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

      if (sub.subscriptions.size >= 20) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Maximum 20 topic subscriptions per connection",
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

    logger.info("client subscribed", { connectionId, topics });
    this.clients.set(ws, sub);
    ws.send(JSON.stringify({ type: "subscribed", topics: topics }));
  }

  private handleUnsubscribe(
    ws: WebSocket,
    message: any,
    _connectionId: string,
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

    for (const t of topics) {
      let norm = t;
      if (!t.includes(":")) {
        norm = `notification:events:${t.toUpperCase()}`;
      }
      sub.subscriptions.delete(norm);
    }

    this.clients.set(ws, sub);
    ws.send(
      JSON.stringify({
        type: "unsubscribed",
        topics: Array.from(sub.subscriptions),
      }),
    );
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
    this.wss.close();
  }

  public getActiveConnectionCount(): number {
    return this.clients.size;
  }
}
