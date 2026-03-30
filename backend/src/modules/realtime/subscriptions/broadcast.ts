import type { RealtimeEnvelope } from "../types.js";
import type { RealtimeTopic } from "./topics.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";

export interface TopicBroadcaster {
  broadcast(topic: RealtimeTopic, message: RealtimeEnvelope): number;
}

export function createTopicBroadcaster(
  registry: SubscriptionRegistry,
  deliver: (clientId: string, message: RealtimeEnvelope) => void,
): TopicBroadcaster {
  return {
    broadcast(topic, message) {
      return registry.broadcast(topic, (clientId) => {
        deliver(clientId, message);
      });
    },
  };
}
