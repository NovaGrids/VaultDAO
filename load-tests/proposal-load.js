import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const options = {
  vus: 100,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
    'error_rate': ['rate<0.1'],
  },
  ext: {
    loadimpact: {
      projectID: 3356643,
      name: 'Proposal Load Test',
    },
  },
};

const errorRate = new Rate('error_rate');
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const apiKey = __ENV.API_KEY || 'test-api-key';

export default function () {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const proposalPayload = {
    title: `Proposal ${Date.now()}`,
    description: 'Load test proposal',
    recipient: 'GBRPYHIL2CI3FD4BWMY3ASQ7VYCU5FCVBNMNGHETA5MFVJTUNXF7AFV4',
    amount: '1000',
  };

  // Create multiple proposals concurrently
  const createRes = http.post(
    `${baseUrl}/proposals`,
    JSON.stringify(proposalPayload),
    { headers }
  );

  const createSuccess = check(createRes, {
    'proposal created': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  if (!createSuccess) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  sleep(1);

  // Get proposals
  const getRes = http.get(`${baseUrl}/proposals`, { headers });

  check(getRes, {
    'proposals fetched': (r) => r.status === 200,
    'response contains data': (r) => r.body.includes('proposals'),
  });

  sleep(1);

  // Get proposal stats
  const statsRes = http.get(`${baseUrl}/proposals/stats`, { headers });

  check(statsRes, {
    'stats fetched': (r) => r.status === 200,
    'stats response valid': (r) => r.json('success') === true,
  });

  sleep(2);
}

export function teardown(data) {
  console.log('Load test completed');
}
