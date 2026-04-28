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

// ── Priority ──────────────────────────────────────────────────────────────────

export enum NotificationPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3,
}

// ── Delivery targets ──────────────────────────────────────────────────────────

export enum NotificationTarget {
  WEBSOCKET = "WEBSOCKET",
  EMAIL = "EMAIL",
  WEBHOOK = "WEBHOOK",
}

// ── Typed payloads ────────────────────────────────────────────────────────────

export interface ProposalCreatedNotification {
  notificationType: "PROPOSAL_CREATED";
  proposalId: string;
}

export interface ProposalApprovedNotification {
  notificationType: "PROPOSAL_APPROVED";
  proposalId: string;
}

export interface ProposalExecutedNotification {
  notificationType: "PROPOSAL_EXECUTED";
  proposalId: string;
  amount: string;
  recipient: string;
  token: string;
}

export interface ProposalExpiredNotification {
  notificationType: "PROPOSAL_EXPIRED";
  proposalId: string;
  expiresAt: string;
}

export interface ProposalVetoedNotification {
  notificationType: "PROPOSAL_VETOED";
  proposalId: string;
}

// ── Priority-aware publish options ────────────────────────────────────────────

export interface PublishOptions {
  priority?: NotificationPriority;
  targets?: NotificationTarget[];
}

// ── Delivery record ───────────────────────────────────────────────────────────

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface DeliveryRecord {
  readonly id: string;
  readonly eventId: string;
  readonly target: NotificationTarget;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly error: string | null;
}

// ── Webhook registration ──────────────────────────────────────────────────────

export interface WebhookRegistration {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly topics: string[];
  readonly createdAt: string;
}
