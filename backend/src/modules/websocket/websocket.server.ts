import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { createLogger } from "../../shared/logging/logger.js";
import type { ContractEvent } from "../events/events.types.js";

const logger = createLogger("websocket-server");

interface ClientSubscription {
  connectionId: string;
  eventTypes?: string[];
  proposalId?: string;
}

export class EventWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientSubscription> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });
    this.init();
  }

  private init() {
    this.wss.on("connection", (ws: WebSocket) => {
      const connectionId = randomUUID();
      logger.info("client connected", { connectionId });

      // Mark alive so the first heartbeat tick does not immediately terminate it
      (ws as any).isAlive = true;
      this.clients.set(ws, { connectionId });

      // Reset liveness on each pong response
      ws.on("pong", () => {
        (ws as any).isAlive = true;
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "subscribe") {
            this.handleSubscription(ws, message, connectionId);
          }
        } catch (error) {
          logger.error("failed to parse client message", { connectionId, error });
        }
      });

      ws.on("close", () => {
        const sub = this.clients.get(ws);
        logger.info("client disconnected", { connectionId: sub?.connectionId ?? connectionId });
        this.clients.delete(ws);
      });

      ws.on("error", (error: Error) => {
        logger.error("websocket error", { connectionId, error });
        this.clients.delete(ws);
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

  private handleSubscription(ws: WebSocket, message: any, connectionId: string) {
    // Support both { type: "subscribe", topics: [...] } and legacy { payload: { eventTypes: [...] } }
    const topics: string[] | undefined =
      Array.isArray(message.topics) ? message.topics :
      Array.isArray(message.payload?.eventTypes) ? message.payload.eventTypes :
      undefined;

    const proposalId: string | undefined =
      message.proposalId ?? message.payload?.proposalId;

    const sub: ClientSubscription = {
      connectionId,
      eventTypes: topics,
      proposalId,
    };

    logger.info("client subscribed", { connectionId, topics, proposalId });
    this.clients.set(ws, sub);
    ws.send(JSON.stringify({ type: "subscribed", topics, proposalId }));
  }

  /**
   * Broadcasts a contract event to all clients subscribed to its topic.
   */
  public broadcastEvent(event: ContractEvent) {
    const eventType = event.topic[0];
    const proposalId =
      event.topic[1] || (event.value && (event.value as any).proposal_id);

    let message: string;
    try {
      message = JSON.stringify({ type: "contract_event", payload: event });
    } catch (error) {
      logger.warn("failed to serialize event for broadcast", { eventId: event.id, error });
      return;
    }

    let broadcastCount = 0;
    this.clients.forEach((sub, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const matchesEventType = !sub.eventTypes || sub.eventTypes.includes(eventType);
      const matchesProposalId = !sub.proposalId || sub.proposalId === proposalId;

      if (matchesEventType && matchesProposalId) {
        try {
          ws.send(message);
          broadcastCount++;
        } catch (error) {
          logger.warn("failed to send event to client", { connectionId: sub.connectionId, eventId: event.id, error });
        }
      }
    });

    if (broadcastCount > 0) {
      logger.info(`broadcasted event ${event.id} to ${broadcastCount} clients`);
    }
  }

  public stop() {
    this.wss.close();
  }
}
