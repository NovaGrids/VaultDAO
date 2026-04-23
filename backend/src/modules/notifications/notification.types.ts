export interface NotificationEvent<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly topic: string;
  readonly source: string;
  readonly createdAt: string;
  readonly payload: TPayload;
}

export type NotificationConsumer = (
  event: NotificationEvent,
) => Promise<void> | void;

export type NotificationUnsubscribe = () => void;

export interface NotificationPublisher {
  publish(event: NotificationEvent): Promise<void>;
}

export interface NotificationSubscriber {
  subscribe(handler: NotificationConsumer): NotificationUnsubscribe;
}

export interface NotificationQueue extends NotificationPublisher, NotificationSubscriber {
  size(): number;
  shutdown(): void;
}
