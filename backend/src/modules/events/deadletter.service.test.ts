import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import DeadLetterService from './deadletter.service.js';

test('DeadLetterService: processes dead-letter with retries and succeeds', async () => {
  const svc = new DeadLetterService({ maxRetries: 3, backoffMs: [10, 10, 10] });

  const entry = { id: '42', contractId: 'CXXX', recordId: 42, retryCount: 1, addedAt: Date.now() };
  svc.add(entry as any);

  let attempts = 0;
  // handler fails twice then succeeds
  const handler = async () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
    return;
  };

  const result = await svc.processDeadLetter('42', handler);
  assert.equal(result, true);
  assert.equal(attempts, 3);
  assert.equal(svc.get('42'), undefined);
});

test('DeadLetterService: exhausts retries and keeps entry', async () => {
  const svc = new DeadLetterService({ maxRetries: 1, backoffMs: [5] });
  const entry = { id: '43', contractId: 'CXXX', recordId: 43, retryCount: 0, addedAt: Date.now() };
  svc.add(entry as any);

  const handler = async () => {
    throw new Error('permanent');
  };

  const result = await svc.processDeadLetter('43', handler);
  assert.equal(result, false);
  const stored = svc.get('43');
  assert.ok(stored);
  assert.equal(stored?.recordId, 43);
});
