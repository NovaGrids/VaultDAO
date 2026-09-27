import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContractEvents, SorobanRpcError, sorobanRpc } from '../sorobanEvents';

type RpcBody = { method: string; params?: { startLedger?: string; pagination?: { limit: number; cursor?: string } } };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeEvents(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: `ev-${offset + i}`, topic: [] }));
}

describe('fetchContractEvents', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the cursor until a short page is returned', async () => {
    const calls: RpcBody[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as RpcBody;
      calls.push(body);
      if (body.method === 'getLatestLedger') return jsonResponse({ result: { sequence: 60_000 } });
      const cursor = body.params?.pagination?.cursor;
      if (!cursor) return jsonResponse({ result: { events: makeEvents(2), cursor: 'c1', latestLedger: 60_000 } });
      return jsonResponse({ result: { events: makeEvents(1, 2), cursor: 'c2', latestLedger: 60_001 } });
    }));

    const result = await fetchContractEvents({ pageSize: 2 });

    expect(result.events.map((e) => e.id)).toEqual(['ev-0', 'ev-1', 'ev-2']);
    expect(result.latestLedger).toBe(60_001);
    expect(result.truncated).toBe(false);
    const eventCalls = calls.filter((c) => c.method === 'getEvents');
    expect(eventCalls[0].params?.startLedger).toBe('10000');
    expect(eventCalls[1].params?.startLedger).toBeUndefined();
    expect(eventCalls[1].params?.pagination?.cursor).toBe('c1');
  });

  it('stops at maxEvents and reports truncation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as RpcBody;
      if (body.method === 'getLatestLedger') return jsonResponse({ result: { sequence: 100 } });
      return jsonResponse({ result: { events: makeEvents(body.params!.pagination!.limit), cursor: 'next' } });
    }));

    const result = await fetchContractEvents({ pageSize: 3, maxEvents: 5 });
    expect(result.events).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchContractEvents({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sorobanRpc', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries transient HTTP failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ result: { sequence: 7 } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sorobanRpc<{ sequence: number }>('getLatestLedger', undefined, {
      retry: { initialDelayMs: 1 },
    });
    expect(result.sequence).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry JSON-RPC errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: -32602, message: 'bad params' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sorobanRpc('getEvents', {}, { retry: { initialDelayMs: 1 } })).rejects.toBeInstanceOf(SorobanRpcError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
