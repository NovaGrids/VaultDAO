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

test('DeadLetterService: DLQ entries survive a service restart via storage adapter', async () => {
  // Minimal in-memory storage adapter standing in for the persistent backend.
  const store = new Map<string, string>();
  const storage = {
    async set(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async get(key: string): Promise<string | undefined> {
      return store.get(key);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };

  const first = new DeadLetterService({ maxRetries: 3, backoffMs: [10], storage: storage as any });
  const entry = { id: '44', contractId: 'CXXX', recordId: 44, retryCount: 0, addedAt: Date.now() };
  first.add(entry as any);
  await first.flush();

  // Simulate a restart: brand new service instance sharing the same storage.
  const restarted = new DeadLetterService({ maxRetries: 3, backoffMs: [10], storage: storage as any });
  await restarted.load();

  const restored = restarted.get('44');
  assert.ok(restored, 'dead-letter entry should survive restart');
  assert.equal(restored?.recordId, 44);
});
