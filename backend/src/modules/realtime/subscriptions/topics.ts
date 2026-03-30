const TOPIC_NAMESPACES = ["proposal", "activity", "system", "notification", "custom"] as const;

export type TopicNamespace = (typeof TOPIC_NAMESPACES)[number];
export type RealtimeTopic = `${TopicNamespace}.${string}`;

function normalizeSegment(segment: string): string {
  return segment.trim().toLowerCase().replace(/\s+/g, "-");
}

export function createRealtimeTopic(namespace: TopicNamespace, key: string): RealtimeTopic {
  const normalizedKey = normalizeSegment(key);
  if (normalizedKey.length === 0) {
    throw new Error("Topic key cannot be empty");
  }
  return `${namespace}.${normalizedKey}`;
}

export function isRealtimeTopic(value: string): value is RealtimeTopic {
  const [namespace, ...rest] = value.split(".");
  if (rest.length === 0) return false;
  if (!TOPIC_NAMESPACES.includes(namespace as TopicNamespace)) return false;
  return rest.join(".").trim().length > 0;
}
