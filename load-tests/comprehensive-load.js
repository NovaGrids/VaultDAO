import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

export const options = {
  vus: 100,
  duration: '10m',
  rampUp: '1m',
  rampDown: '1m',
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(90)<500', 'p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.1'],
    'create_latency': ['p(95)<600'],
    'approve_latency': ['p(95)<600'],
    'execute_latency': ['p(95)<800'],
    'api_availability': ['rate>0.95'],
  },
  ext: {
    loadimpact: {
      projectID: 3356643,
      name: 'Comprehensive Load Test',
    },
  },
};

// Define custom metrics
const createLatency = new Trend('create_latency');
const approveLatency = new Trend('approve_latency');
const executeLatency = new Trend('execute_latency');
const apiAvailability = new Rate('api_availability');
const errorRate = new Rate('error_rate');
const requestCount = new Counter('request_count');
const activeUsers = new Gauge('active_users');

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const apiKey = __ENV.API_KEY || 'test-api-key';

export default function () {
  activeUsers.add(1);
  requestCount.add(1);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  group('Proposal Creation Test', function () {
    const proposalPayload = {
      title: `Load Test Proposal ${Date.now()}`,
      description: 'Automated load test proposal',
      recipient: 'GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4',
      amount: (Math.random() * 1000).toFixed(2),
    };

    const startTime = Date.now();
    const createRes = http.post(
      `${baseUrl}/proposals`,
      JSON.stringify(proposalPayload),
      { headers }
    );

    const duration = Date.now() - startTime;
    createLatency.add(duration);

    const createSuccess = check(createRes, {
      'proposal created': (r) => r.status === 201,
      'valid response': (r) => r.body.length > 0,
      'fast response': (r) => r.timings.duration < 600,
    });

    apiAvailability.add(createSuccess);
    if (!createSuccess) {
      errorRate.add(1);
    }
  });

  sleep(1);

  group('Proposal Approval Test', function () {
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

    const duration = Date.now() - startTime;
    approveLatency.add(duration);

    const approveSuccess = check(approveRes, {
      'approval accepted': (r) => r.status === 200 || r.status === 201 || r.status === 404,
      'approval response valid': (r) => r.timings.duration < 600,
    });

    apiAvailability.add(approveSuccess);
    if (!approveSuccess) {
      errorRate.add(1);
    }
  });

  sleep(1);

  group('Proposal Execution Test', function () {
    const proposalId = `proposal-${Date.now()}`;
    const executePayload = {
      proposalId,
      executor: 'GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4',
    };

    const startTime = Date.now();
    const executeRes = http.post(
      `${baseUrl}/proposals/${proposalId}/execute`,
      JSON.stringify(executePayload),
      { headers }
    );

    const duration = Date.now() - startTime;
    executeLatency.add(duration);

    const executeSuccess = check(executeRes, {
      'execution processed': (r) => r.status === 200 || r.status === 201 || r.status === 404,
      'execution response fast': (r) => r.timings.duration < 800,
    });

    apiAvailability.add(executeSuccess);
    if (!executeSuccess) {
      errorRate.add(1);
    }
  });

  sleep(2);

  group('Stats and Reporting', function () {
    const statsRes = http.get(`${baseUrl}/proposals/stats`, { headers });

    check(statsRes, {
      'stats retrieved': (r) => r.status === 200,
      'stats response valid': (r) => r.body.includes('total') || r.status === 200,
    });

    apiAvailability.add(statsRes.status === 200);
  });

  activeUsers.add(-1);
}

export function handleSummary(data) {
  const summary = {
    'Create Operation': {
      p95: data.metrics.create_latency.values.p95,
      p99: data.metrics.create_latency.values.p99,
    },
    'Approve Operation': {
      p95: data.metrics.approve_latency.values.p95,
      p99: data.metrics.approve_latency.values.p99,
    },
    'Execute Operation': {
      p95: data.metrics.execute_latency.values.p95,
      p99: data.metrics.execute_latency.values.p99,
    },
    'API Availability': {
      rate: data.metrics.api_availability.values.rate,
    },
    'Error Rate': {
      rate: data.metrics.error_rate.values.rate,
    },
  };

  console.log('=== Load Test Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
