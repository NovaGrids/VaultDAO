import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalStatus } from "./types";
import { watchProposal } from "./watch-proposal";

const { getEvents } = vi.hoisted(() => ({ getEvents: vi.fn() }));

vi.mock("stellar-sdk", () => ({
  SorobanRpc: {
    Server: class {
      getEvents = getEvents;
    },
  },
  xdr: {
    ScVal: { fromXDR: () => { throw new Error("plain topic"); } },
  },
}));

const opts = {
  contractId: "CVAULT",
  rpcUrl: "https://rpc.example",
  networkPassphrase: "test",
  proposalWatchIntervalMs: 1000,
};

afterEach(() => {
  vi.useRealTimers();
  getEvents.mockReset();
});

describe("watchProposal", () => {
  it("publishes matching lifecycle events and ignores duplicates", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const event = {
      id: "event-1",
      ledger: 42,
      pagingToken: "cursor-1",
      topic: ["proposal_approved", "7"],
    };
    getEvents.mockResolvedValue({
      events: [
        event,
        { ...event, id: "other-proposal", topic: ["proposal_executed", "8"] },
      ],
    });

    const unsubscribe = watchProposal(opts, 7n, onChange);
    await vi.runOnlyPendingTimersAsync();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: 7n,
      eventType: "proposal_approved",
      status: ProposalStatus.Pending,
      ledger: 42,
    }));
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ type: "contract", contractIds: ["CVAULT"] }],
    }));

    unsubscribe();
    await vi.runOnlyPendingTimersAsync();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops an in-flight result after unsubscribe", async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: unknown) => void;
    getEvents.mockReturnValue(new Promise((resolve) => { resolvePoll = resolve; }));
    const onChange = vi.fn();
    const unsubscribe = watchProposal(opts, 7n, onChange);

    unsubscribe();
    resolvePoll({ events: [{ id: "event-1", ledger: 42, topic: ["proposal_created", "7"] }] });
    await vi.runOnlyPendingTimersAsync();

    expect(onChange).not.toHaveBeenCalled();
    expect(getEvents).toHaveBeenCalledTimes(1);
  });
});