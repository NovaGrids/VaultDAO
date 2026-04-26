import { performanceTracker } from './performanceTracking';

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export interface RpcCall {
  endpoint: string;
  duration: number;
  success: boolean;
  timestamp: number;
}

/** Ring buffer of the last 20 RPC calls for the latency histogram */
const RPC_BUFFER_SIZE = 20;
const rpcHistory: RpcCall[] = [];

function recordRpc(call: RpcCall): void {
  rpcHistory.push(call);
  if (rpcHistory.length > RPC_BUFFER_SIZE) rpcHistory.shift();
}

/** Returns a snapshot of the last 20 RPC calls (newest last) */
export function getRpcHistory(): RpcCall[] {
  return [...rpcHistory];
}

/** Wrap fetch to track RPC call latency, success/failure, and endpoint */
export async function trackedFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const startTime = performance.now();
  const { timeout = 30000, ...fetchOptions } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    clearTimeout(timeoutId);

    const duration = performance.now() - startTime;
    recordRpc({ endpoint: url, duration, success: response.ok, timestamp: Date.now() });

    if (duration > 1000) {
      performanceTracker.trackSlowQuery(url, duration, 'api');
    }

    return response;
  } catch (error) {
    const duration = performance.now() - startTime;
    recordRpc({ endpoint: url, duration, success: false, timestamp: Date.now() });
    performanceTracker.trackSlowQuery(url, duration, 'api');
    throw error;
  }
}

export function createTrackedFetch(baseURL?: string) {
  return (url: string, options?: FetchOptions): Promise<Response> =>
    trackedFetch(baseURL ? `${baseURL}${url}` : url, options);
}

export async function batchTrackedFetch(
  requests: Array<{ url: string; options?: FetchOptions }>,
  batchName: string
): Promise<Response[]> {
  const startTime = performance.now();
  try {
    const responses = await Promise.all(requests.map((r) => trackedFetch(r.url, r.options)));
    const duration = performance.now() - startTime;
    if (duration > 1000) {
      performanceTracker.trackSlowQuery(`${batchName} (${requests.length} requests)`, duration, 'api');
    }
    return responses;
  } catch (error) {
    const duration = performance.now() - startTime;
    performanceTracker.trackSlowQuery(`${batchName} (${requests.length} requests) - FAILED`, duration, 'api');
    throw error;
  }
}
