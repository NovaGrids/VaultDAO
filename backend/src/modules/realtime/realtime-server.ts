import { createLogger } from "../../shared/logging/logger.js";
import {
  createRealtimeTopic,
  createTopicBroadcaster,
  SubscriptionRegistry,
  type RealtimeTopic,
} from "./subscriptions/index.js";
import type {
  RealtimeConnection,
  RealtimeConnectionLifecycleHooks,
  RealtimeEnvelope,
} from "./types.js";

export class RealtimeServer {
  private readonly logger = createLogger("realtime-server");
  private readonly connections = new Map<string, RealtimeConnection>();
  private readonly subscriptions = new SubscriptionRegistry();
  private readonly broadcaster = createTopicBroadcaster(
    this.subscriptions,
    (clientId, message) => this.deliver(clientId, message),
  );
  private readonly hooks: RealtimeConnectionLifecycleHooks;
  private started = false;

  constructor(hooks: RealtimeConnectionLifecycleHooks = {}) {
    this.hooks = hooks;
  }

  public start(): void {
    if (this.started) {
      this.logger.warn("realtime server already started");
      return;
    }

    this.started = true;
    this.logger.info("realtime server scaffold started");
  }

  public stop(): void {
    if (!this.started) return;

    const connectedIds = Array.from(this.connections.keys());
    for (const connectionId of connectedIds) {
      this.unregisterConnection(connectionId, "server shutdown");
    }

    this.started = false;
    this.logger.info("realtime server scaffold stopped");
  }

  public registerConnection(connection: RealtimeConnection): void {
    this.connections.set(connection.id, connection);
    this.hooks.onConnected?.(connection.id);

    connection.send({
      type: "hello",
      ts: new Date().toISOString(),
      payload: {
        connectionId: connection.id,
        status: "connected",
      },
    });

    this.logger.info("connection registered", { connectionId: connection.id });
  }

  public unregisterConnection(connectionId: string, reason = "client disconnected"): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.subscriptions.unsubscribeAll(connectionId);
    this.connections.delete(connectionId);
    this.hooks.onDisconnected?.(connectionId);

    connection.close?.(1000, reason);
    this.logger.info("connection unregistered", { connectionId, reason });
  }

  public subscribe(connectionId: string, topic: RealtimeTopic): boolean {
    if (!this.connections.has(connectionId)) {
      this.logger.warn("subscribe attempted for unknown connection", { connectionId, topic });
      return false;
    }

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

  public broadcast(topic: RealtimeTopic, payload: unknown): number {
    return this.broadcaster.broadcast(topic, {
      type: "event",
      topic,
      payload,
      ts: new Date().toISOString(),
    });
  }

  public createTopic(namespace: "proposal" | "activity" | "system" | "notification" | "custom", key: string): RealtimeTopic {
    return createRealtimeTopic(namespace, key);
  }

  public getConnectionCount(): number {
    return this.connections.size;
  }

  public getSubscriptions(connectionId: string): ReadonlySet<RealtimeTopic> {
    return this.subscriptions.getTopics(connectionId);
  }

  private deliver(connectionId: string, message: RealtimeEnvelope): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      connection.send(message);
    } catch (err) {
      this.logger.warn("failed to deliver realtime message", {
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
