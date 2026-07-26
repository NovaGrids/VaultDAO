import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

export const options = {
  vus: 50,
  duration: '5m',
  rampUp: '1m',
  rampDown: '1m',
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
    'approval_latency': ['p(95)<600'],
  },
};

const approvalLatency = new Trend('approval_latency');
const approvalRate = new Rate('approval_rate');
const approvalCounter = new Counter('approval_count');
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const apiKey = __ENV.API_KEY || 'test-api-key';

export default function () {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Get pending proposals
  const getRes = http.get(`${baseUrl}/proposals?status=pending`, { headers });

  check(getRes, {
    'fetch pending proposals': (r) => r.status === 200,
  });

  if (getRes.status !== 200) {
    approvalRate.add(0);
    return;
  }

  // Extract proposal ID from response (simulated)
  const proposalId = `proposal-${Date.now()}`;

  const approvalPayload = {
    proposalId,
    approver: 'GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4',
  };

  const startTime = Date.now();
  const approveRes = http.post(
    `${baseUrl}/proposals/${proposalId}/approve`,
    JSON.stringify(approvalPayload),
    { headers }
  );

  const approvalDuration = Date.now() - startTime;
  approvalLatency.add(approvalDuration);

  const approveSuccess = check(approveRes, {
    'proposal approved': (r) => r.status === 200 || r.status === 201,
    'approval response valid': (r) => r.json('success') === true || r.status === 200,
    'approval latency < 600ms': (r) => approvalDuration < 600,
  });

  if (approveSuccess) {
    approvalRate.add(1);
    approvalCounter.add(1);
  } else {
    approvalRate.add(0);
  }

  sleep(1);

  // Get updated proposal status
  const statusRes = http.get(`${baseUrl}/proposals/${proposalId}`, { headers });

  check(statusRes, {
    'proposal status retrieved': (r) => r.status === 200 || r.status === 404,
  });

  sleep(2);
}

export function summary(data) {
  console.log('=== Approval Load Test Summary ===');
  console.log(`Total approvals: ${data.metrics.approval_count.value}`);
  console.log(`Approval success rate: ${(data.metrics.approval_rate.value * 100).toFixed(2)}%`);
}
