import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { createLogger } from "../../shared/logging/logger.js";
import type { ContractEvent } from "../events/events.types.js";

const logger = createLogger("websocket-server");

interface ClientSubscription {
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
      logger.info("new client connected");
      this.clients.set(ws, {});

      ws.on("message", (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === "subscribe") {
            this.handleSubscription(ws, message.payload);
          }
        } catch (error) {
          logger.error("failed to parse client message", { error });
        }
      });

      ws.on("close", () => {
        logger.info("client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        logger.error("websocket error", { error });
        this.clients.delete(ws);
      });
    });

    // Heartbeat to clean up stale connections
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

  private handleSubscription(ws: WebSocket, payload: ClientSubscription) {
    logger.info("client subscribed", { payload });
    this.clients.set(ws, payload);
    ws.send(JSON.stringify({ type: "subscribed", payload }));
  }

  /**
   * Broadcasts a contract event to all interested clients.
   */
  public broadcastEvent(event: ContractEvent) {
    const eventType = event.topic[0];
    // Simple heuristic for proposal ID if present in topics or value
    const proposalId = event.topic[1] || (event.value && event.value.proposal_id);

    const message = JSON.stringify({
      type: "contract_event",
      payload: event,
    });

    let broadcastCount = 0;
    this.clients.forEach((sub, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const matchesEventType = !sub.eventTypes || sub.eventTypes.includes(eventType);
      const matchesProposalId = !sub.proposalId || sub.proposalId === proposalId;

      if (matchesEventType && matchesProposalId) {
        ws.send(message);
        broadcastCount++;
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
