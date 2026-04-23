import type { RealtimeTopic } from "./topics.js";

function getOrCreate<TKey, TValue>(
  map: Map<TKey, Set<TValue>>,
  key: TKey,
): Set<TValue> {
  const existing = map.get(key);
  if (existing) return existing;

  const created = new Set<TValue>();
  map.set(key, created);
  return created;
}

export class SubscriptionRegistry {
  private readonly byTopic = new Map<RealtimeTopic, Set<string>>();
  private readonly byClient = new Map<string, Set<RealtimeTopic>>();

  public subscribe(clientId: string, topic: RealtimeTopic): boolean {
    const clientTopics = getOrCreate(this.byClient, clientId);
    if (clientTopics.has(topic)) return false;

    clientTopics.add(topic);
    getOrCreate(this.byTopic, topic).add(clientId);
    return true;
  }

  public unsubscribe(clientId: string, topic: RealtimeTopic): boolean {
    const clientTopics = this.byClient.get(clientId);
    if (!clientTopics || !clientTopics.has(topic)) return false;

    clientTopics.delete(topic);
    if (clientTopics.size === 0) {
      this.byClient.delete(clientId);
    }

    const subscribers = this.byTopic.get(topic);
    if (!subscribers) return true;

    subscribers.delete(clientId);
    if (subscribers.size === 0) {
      this.byTopic.delete(topic);
    }

    return true;
  }

  public unsubscribeAll(clientId: string): number {
    const topics = this.byClient.get(clientId);
    if (!topics) return 0;

    const topicList = Array.from(topics);
    for (const topic of topicList) {
      this.unsubscribe(clientId, topic);
    }

    return topicList.length;
  }

  public getSubscribers(topic: RealtimeTopic): ReadonlySet<string> {
    return this.byTopic.get(topic) ?? new Set<string>();
  }

  public getTopics(clientId: string): ReadonlySet<RealtimeTopic> {
    return this.byClient.get(clientId) ?? new Set<RealtimeTopic>();
  }

  public broadcast(topic: RealtimeTopic, send: (clientId: string) => void): number {
    const subscribers = this.byTopic.get(topic);
    if (!subscribers || subscribers.size === 0) return 0;

    let delivered = 0;
    for (const clientId of subscribers) {
      send(clientId);
      delivered += 1;
    }

    return delivered;
  }
}
