import type { RealtimeTopic } from "./subscriptions/topics.js";

export type RealtimeMessageType =
  | "hello"
  | "event"
  | "subscribed"
  | "unsubscribed"
  | "error";

export interface RealtimeEnvelope<TPayload = unknown> {
  readonly type: RealtimeMessageType;
  readonly topic?: RealtimeTopic;
  readonly payload?: TPayload;
  readonly ts: string;
}

export interface RealtimeConnection {
  readonly id: string;
  send(message: RealtimeEnvelope): void;
  close?(code?: number, reason?: string): void;
}

export interface RealtimeConnectionLifecycleHooks {
  onConnected?(connectionId: string): void;
  onDisconnected?(connectionId: string): void;
  onSubscribed?(connectionId: string, topic: RealtimeTopic): void;
  onUnsubscribed?(connectionId: string, topic: RealtimeTopic): void;
}
