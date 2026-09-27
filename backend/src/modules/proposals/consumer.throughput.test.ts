import assert from "node:assert/strict";
import test from "node:test";
import { ProposalActivityConsumer } from "./consumer.js";
import { EventType, type NormalizedEvent } from "../events/types.js";
import {
  MetricsRegistry,
  PROPOSALS_CREATED_COUNTER,
  PROPOSALS_EXECUTED_COUNTER,
  registerProposalThroughputMetrics,
} from "../health/metrics.registry.js";

let eventCounter = 0;

function makeEvent(
  type: EventType,
  overrides: { proposalId?: string; ledger?: number } = {},
): NormalizedEvent {
  eventCounter++;
  return {
    type,
    data: {
      proposalId: overrides.proposalId ?? String(eventCounter),
      proposer: "GPROPOSER",
      recipient: "GRECIPIENT",
      token: "USDC",
      // Vary the amount per event: the fingerprint store treats two
      // PROPOSAL_CREATED payloads with identical content as duplicates.
      amount: String(100 + eventCounter),
      executor: "GEXECUTOR",
    },
    metadata: {
      id: `event-${eventCounter}`,
      contractId: "CCONTRACT",
      ledger: overrides.ledger ?? 1000 + eventCounter,
      ledgerClosedAt: new Date().toISOString(),
      transactionHash: `tx-${eventCounter}`,
      eventIndex: 0,
    },
  } as unknown as NormalizedEvent;
}

function counterValue(registry: MetricsRegistry, name: string): number {
  return registry.snapshot().values.get(name) ?? 0;
}

test("proposal throughput counters", async (t) => {
  await t.test("are registered with counter metadata and help text", () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);

    const { metadata } = registry.snapshot();
    for (const name of [PROPOSALS_CREATED_COUNTER, PROPOSALS_EXECUTED_COUNTER]) {
      const meta = metadata.get(name);
      assert.ok(meta, `${name} is registered`);
      assert.equal(meta.type, "counter");
      assert.ok(meta.help.length > 0, `${name} has help text`);
    }
  });

  await t.test("are rendered in the Prometheus scrape output", async () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);
    const consumer = new ProposalActivityConsumer({ metricsRegistry: registry });

    await consumer.process(makeEvent(EventType.PROPOSAL_CREATED));

    const rendered = registry.render();
    assert.match(rendered, /# TYPE proposals_created_total counter/);
    assert.match(rendered, /# TYPE proposals_executed_total counter/);
    assert.match(rendered, /^proposals_created_total 1$/m);
  });

  await t.test("count created and executed events independently", async () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);
    const consumer = new ProposalActivityConsumer({ metricsRegistry: registry });

    await consumer.process(makeEvent(EventType.PROPOSAL_CREATED));
    await consumer.process(makeEvent(EventType.PROPOSAL_CREATED));
    await consumer.process(makeEvent(EventType.PROPOSAL_EXECUTED));

    assert.equal(counterValue(registry, PROPOSALS_CREATED_COUNTER), 2);
    assert.equal(counterValue(registry, PROPOSALS_EXECUTED_COUNTER), 1);
  });

  await t.test("ignore unrelated proposal lifecycle events", async () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);
    const consumer = new ProposalActivityConsumer({ metricsRegistry: registry });

    await consumer.process(makeEvent(EventType.PROPOSAL_APPROVED));
    await consumer.process(makeEvent(EventType.PROPOSAL_REJECTED));

    assert.equal(counterValue(registry, PROPOSALS_CREATED_COUNTER), 0);
    assert.equal(counterValue(registry, PROPOSALS_EXECUTED_COUNTER), 0);
  });

  await t.test("do not count deduplicated events twice", async () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);
    const consumer = new ProposalActivityConsumer({ metricsRegistry: registry });

    const event = makeEvent(EventType.PROPOSAL_CREATED);
    await consumer.process(event);
    // Same transactionHash + eventIndex — rejected by the event-id dedup set.
    await consumer.process(event);

    assert.equal(counterValue(registry, PROPOSALS_CREATED_COUNTER), 1);
  });

  await t.test("count events arriving through processBatch", async () => {
    const registry = new MetricsRegistry();
    registerProposalThroughputMetrics(registry);
    const consumer = new ProposalActivityConsumer({ metricsRegistry: registry });

    await consumer.processBatch([
      makeEvent(EventType.PROPOSAL_CREATED),
      makeEvent(EventType.PROPOSAL_EXECUTED),
      makeEvent(EventType.PROPOSAL_EXECUTED),
    ]);

    assert.equal(counterValue(registry, PROPOSALS_CREATED_COUNTER), 1);
    assert.equal(counterValue(registry, PROPOSALS_EXECUTED_COUNTER), 2);
  });
});
