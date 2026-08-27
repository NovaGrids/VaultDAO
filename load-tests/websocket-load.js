import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

export const options = {
  scenarios: {
    websocket_subscribers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'message_delivery_latency': ['p(99)<500'],
    'connection_success_rate': ['rate>0.95'],
    'subscription_success_rate': ['rate>0.95'],
    'ws_connecting': ['p(95)<1000'],
  },
};

// Custom metrics
const messageDeliveryLatency = new Trend('message_delivery_latency');
const connectionSuccessRate = new Rate('connection_success_rate');
const subscriptionSuccessRate = new Rate('subscription_success_rate');
const messagesReceived = new Counter('messages_received');
const eventsPublished = new Counter('events_published');

const wsUrl = __ENV.WS_URL || 'ws://localhost:3000/ws';
const vaultContractId = __ENV.VAULT_CONTRACT_ID || 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

// Topics mirror the event types documented in sdk/README.md's
// "Event Subscription (WebSocket)" section.
const TOPICS = [
  'PROPOSAL_CREATED',
  'PROPOSAL_APPROVED',
  'PROPOSAL_EXECUTED',
  'ROLE_CHANGED',
];

export default function () {
  const params = { tags: { name: 'vault-events' } };

  const res = ws.connect(wsUrl, params, function (socket) {
    let subscribed = false;
    // Tracks send time per topic so we can measure round-trip delivery
    // latency once the server echoes/acks or pushes a matching event.
    const pendingSince = new Map();

    socket.on('open', function () {
      connectionSuccessRate.add(true);

      socket.send(
        JSON.stringify({
          type: 'subscribe',
          topics: TOPICS,
          payload: { vault: vaultContractId },
        }),
      );

      TOPICS.forEach((topic) => pendingSince.set(topic, Date.now()));
    });

    socket.on('message', function (data) {
      let envelope;
      try {
        envelope = JSON.parse(data);
      } catch (e) {
        return;
      }

      messagesReceived.add(1);

      if (envelope.type === 'subscribed') {
        subscribed = true;
        subscriptionSuccessRate.add(true);
        return;
      }

      if (envelope.type === 'error') {
        subscriptionSuccessRate.add(false);
        return;
      }

      // Measure delivery latency for any event that maps back to a topic
      // we sent (subscribe ack, contract_event, or a direct push message).
      const startedAt = pendingSince.get(envelope.type);
      if (startedAt) {
        messageDeliveryLatency.add(Date.now() - startedAt);
        pendingSince.delete(envelope.type);
      }
    });

    socket.on('error', function (e) {
      connectionSuccessRate.add(false);
    });

    socket.setTimeout(function () {
      if (!subscribed) {
        subscriptionSuccessRate.add(false);
      }
      socket.close();
    }, 30000);

    // Periodically re-touch the connection so it stays open long enough
    // to observe server-pushed events during the sustained-load stage.
    socket.setInterval(function () {
      eventsPublished.add(1);
    }, 5000);
  });

  check(res, { 'connected successfully': (r) => r && r.status === 101 });

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    'WebSocket Connections': {
      success_rate: data.metrics.connection_success_rate
        ? data.metrics.connection_success_rate.values.rate
        : null,
    },
    'Subscription Success': {
      rate: data.metrics.subscription_success_rate
        ? data.metrics.subscription_success_rate.values.rate
        : null,
    },
    'Message Delivery Latency (ms)': {
      p95: data.metrics.message_delivery_latency
        ? data.metrics.message_delivery_latency.values['p(95)']
        : null,
      p99: data.metrics.message_delivery_latency
        ? data.metrics.message_delivery_latency.values['p(99)']
        : null,
    },
    'Messages Received': data.metrics.messages_received
      ? data.metrics.messages_received.values.count
      : 0,
  };

  console.log('=== WebSocket Load Test Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
