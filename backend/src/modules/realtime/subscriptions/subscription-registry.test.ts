import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionRegistry } from "./subscription-registry.js";
import { createRealtimeTopic } from "./topics.js";

test("SubscriptionRegistry", async (t) => {
  await t.test("tracks subscribe and unsubscribe per client/topic", () => {
    const registry = new SubscriptionRegistry();
    const topic = createRealtimeTopic("proposal", "created");

    assert.equal(registry.subscribe("client-1", topic), true);
    assert.equal(registry.subscribe("client-1", topic), false);
    assert.deepEqual(Array.from(registry.getTopics("client-1")), [topic]);
    assert.deepEqual(Array.from(registry.getSubscribers(topic)), ["client-1"]);

    assert.equal(registry.unsubscribe("client-1", topic), true);
    assert.equal(registry.unsubscribe("client-1", topic), false);
    assert.equal(registry.getTopics("client-1").size, 0);
    assert.equal(registry.getSubscribers(topic).size, 0);
  });

  await t.test("broadcast reaches only topic subscribers", () => {
    const registry = new SubscriptionRegistry();
    const topicA = createRealtimeTopic("activity", "ledger-update");
    const topicB = createRealtimeTopic("system", "health");

    registry.subscribe("client-a", topicA);
    registry.subscribe("client-b", topicA);
    registry.subscribe("client-c", topicB);

    const recipients: string[] = [];
    const delivered = registry.broadcast(topicA, (clientId) => {
      recipients.push(clientId);
    });

    assert.equal(delivered, 2);
    assert.deepEqual(new Set(recipients), new Set(["client-a", "client-b"]));
  });

  await t.test("unsubscribeAll removes all client subscriptions", () => {
    const registry = new SubscriptionRegistry();
    const topicA = createRealtimeTopic("notification", "queue");
    const topicB = createRealtimeTopic("custom", "audit-feed");

    registry.subscribe("client-z", topicA);
    registry.subscribe("client-z", topicB);

    const removed = registry.unsubscribeAll("client-z");
    assert.equal(removed, 2);
    assert.equal(registry.getTopics("client-z").size, 0);
    assert.equal(registry.getSubscribers(topicA).size, 0);
    assert.equal(registry.getSubscribers(topicB).size, 0);
  });
});
