import { rpc } from "@stellar/stellar-sdk";
import type { SdkOptions } from "./types";

/** Cache of RPC servers, keyed by URL and HTTP setting, so each request reuses one instance. */
const serverCache = new Map<string, rpc.Server>();

/** True when the URL points at the local machine (e.g. a Quickstart node). */
export function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Resolve whether plain HTTP is allowed for this connection.
 * An explicit `allowHttp` wins; otherwise HTTP is allowed only for localhost.
 */
export function resolveAllowHttp(opts: Pick<SdkOptions, "rpcUrl" | "allowHttp">): boolean {
  return opts.allowHttp ?? isLocalhostUrl(opts.rpcUrl);
}

/**
 * Get a shared `rpc.Server` for the options' RPC URL.
 * Servers are created once per URL and HTTP setting, then reused.
 */
export function getRpcServer(opts: SdkOptions): rpc.Server {
  const allowHttp = resolveAllowHttp(opts);
  const key = `${opts.rpcUrl}|${allowHttp}`;

  let server = serverCache.get(key);
  if (!server) {
    server = new rpc.Server(opts.rpcUrl, { allowHttp });
    serverCache.set(key, server);
  }
  return server;
}
