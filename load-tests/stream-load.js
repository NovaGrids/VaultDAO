import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for stream payment triggers
const streamPaymentErrors = new Rate('stream_payment_errors');
const streamPaymentDuration = new Trend('stream_payment_duration', true);

// Environment configuration, consistent with other load tests
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';
const STREAM_ID = __ENV.STREAM_ID || '1';

// 50 concurrent VUs each triggering a stream payment against the same stream
export const options = {
  scenarios: {
    concurrent_stream_payments: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<2000'],
    http_req_failed: ['rate<0.01'],
    stream_payment_errors: ['rate<0.01'],
    stream_payment_duration: ['p(99)<2000'],
  },
};

function authHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

export default function () {
  const url = `${BASE_URL}/api/streams/${STREAM_ID}/trigger_stream_payment`;
  const payload = JSON.stringify({
    stream_id: STREAM_ID,
  });

  const res = http.post(url, payload, {
    headers: authHeaders(),
    tags: { name: 'trigger_stream_payment' },
  });

  streamPaymentDuration.add(res.timings.duration);
  streamPaymentErrors.add(res.status === 0 || res.status >= 500);

  check(res, {
    'trigger_stream_payment responded': (r) => r.status !== 0,
    'trigger_stream_payment not server error': (r) => r.status < 500,
    'trigger_stream_payment latency < 2s': (r) => r.timings.duration < 2000,
  });

  sleep(0.1);
}