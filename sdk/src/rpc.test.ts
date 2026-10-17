import { describe, expect, it } from "vitest";
import { getRpcServer, isLocalhostUrl, resolveAllowHttp } from "./rpc";
import type { SdkOptions } from "./types";

const base: SdkOptions = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("isLocalhostUrl", () => {
  it("recognises local hosts", () => {
    expect(isLocalhostUrl("http://localhost:8000/soroban/rpc")).toBe(true);
    expect(isLocalhostUrl("http://127.0.0.1:8000/soroban/rpc")).toBe(true);
    expect(isLocalhostUrl("http://[::1]:8000/soroban/rpc")).toBe(true);
  });

  it("rejects remote hosts and malformed URLs", () => {
    expect(isLocalhostUrl("https://soroban-testnet.stellar.org")).toBe(false);
    expect(isLocalhostUrl("http://localhost.example.com")).toBe(false);
    expect(isLocalhostUrl("not a url")).toBe(false);
  });
});

describe("resolveAllowHttp", () => {
  it("defaults to false for remote endpoints", () => {
    expect(resolveAllowHttp(base)).toBe(false);
  });

  it("defaults to true for localhost", () => {
    expect(resolveAllowHttp({ ...base, rpcUrl: "http://localhost:8000/soroban/rpc" })).toBe(true);
  });

  it("uses an explicit allowHttp value over the localhost default", () => {
    expect(resolveAllowHttp({ ...base, allowHttp: true })).toBe(true);
    expect(resolveAllowHttp({ ...base, rpcUrl: "http://localhost:8000", allowHttp: false })).toBe(false);
  });
});

describe("getRpcServer", () => {
  it("reuses one server for the same RPC URL", () => {
    expect(getRpcServer(base)).toBe(getRpcServer({ ...base }));
  });

  it("creates separate servers for different RPC URLs", () => {
    expect(getRpcServer(base)).not.toBe(getRpcServer({ ...base, rpcUrl: "https://rpc.example" }));
  });

  it("connects to a localhost endpoint over http without extra configuration", () => {
    expect(() => getRpcServer({ ...base, rpcUrl: "http://localhost:8000/soroban/rpc" })).not.toThrow();
  });

  it("rejects a remote http endpoint unless allowHttp is set", () => {
    const remote = { ...base, rpcUrl: "http://rpc.example" };

    expect(() => getRpcServer(remote)).toThrow();
    expect(() => getRpcServer({ ...remote, allowHttp: true })).not.toThrow();
  });
});
