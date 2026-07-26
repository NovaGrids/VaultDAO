import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposalTimeline, type ProposalTimelineProps } from '../ProposalTimeline';

describe('ProposalTimeline', () => {
  const baseProps: ProposalTimelineProps = {
    proposalId: 1,
    currentStatus: 'Pending',
    events: [
      {
        status: 'created',
        timestamp: Math.floor(Date.now() / 1000) - 3600,
        label: 'Proposal Created',
      },
    ],
    approvalsReceived: 1,
    approvalsRequired: 3,
    isExecuted: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render proposal timeline with basic info', () => {
    render(<ProposalTimeline {...baseProps} />);

    expect(screen.getByText(/Proposal #1 Timeline/)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('should display approval progress bar', () => {
    render(<ProposalTimeline {...baseProps} />);

    expect(screen.getByText('1 of 3 signers approved')).toBeInTheDocument();
  });

  it('should show correct approval percentage', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      approvalsReceived: 2,
      approvalsRequired: 3,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText(/67%/)).toBeInTheDocument();
  });

  it('should display status progression timeline', () => {
    render(<ProposalTimeline {...baseProps} />);

    expect(screen.getByText('Status Progression')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Executed')).toBeInTheDocument();
  });

  it('should render event history', () => {
    render(<ProposalTimeline {...baseProps} />);

    expect(screen.getByText('Event History')).toBeInTheDocument();
    expect(screen.getByText('Proposal Created')).toBeInTheDocument();
  });

  it('should show empty state for no events', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      events: [],
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });

  it('should display timelock deadline when provided', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
    const props: ProposalTimelineProps = {
      ...baseProps,
      timelockDeadline: futureTimestamp,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Timelock Deadline')).toBeInTheDocument();
  });

  it('should calculate time remaining correctly', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const props: ProposalTimelineProps = {
      ...baseProps,
      timelockDeadline: futureTimestamp,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
  });

  it('should show expired status for past deadline', () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const props: ProposalTimelineProps = {
      ...baseProps,
      timelockDeadline: pastTimestamp,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('should display executed status correctly', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      currentStatus: 'Executed',
      isExecuted: true,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Executed')).toBeInTheDocument();
  });

  it('should display rejected status correctly', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      currentStatus: 'Rejected',
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText(/This proposal has been rejected/)).toBeInTheDocument();
  });

  it('should display cancelled status correctly', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      currentStatus: 'Cancelled',
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/This proposal has been cancelled/)).toBeInTheDocument();
  });

  it('should show approved status', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      currentStatus: 'Approved',
      approvalsReceived: 3,
      approvalsRequired: 3,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('should format timestamps correctly', () => {
    const timestamp = 1609459200; // 2021-01-01 00:00:00 UTC
    const props: ProposalTimelineProps = {
      ...baseProps,
      events: [
        {
          status: 'test',
          timestamp,
          label: 'Test Event',
        },
      ],
    };

    render(<ProposalTimeline {...props} />);
    // Should render without error, actual date format tested separately
    expect(screen.getByText('Test Event')).toBeInTheDocument();
  });

  it('should handle multiple events in timeline', () => {
    const props: ProposalTimelineProps = {
      ...baseProps,
      events: [
        {
          status: 'created',
          timestamp: Math.floor(Date.now() / 1000) - 7200,
          label: 'Proposal Created',
        },
        {
          status: 'approved',
          timestamp: Math.floor(Date.now() / 1000) - 3600,
          label: 'First Approval',
        },
        {
          status: 'approved',
          timestamp: Math.floor(Date.now() / 1000) - 1800,
          label: 'Second Approval',
        },
      ],
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.getByText('Proposal Created')).toBeInTheDocument();
    expect(screen.getByText('First Approval')).toBeInTheDocument();
    expect(screen.getByText('Second Approval')).toBeInTheDocument();
  });

  it('should update approval percentage with different values', () => {
    const testCases = [
      { received: 0, required: 3, expected: '0%' },
      { received: 1, required: 3, expected: '33%' },
      { received: 2, required: 3, expected: '67%' },
      { received: 3, required: 3, expected: '100%' },
    ];

    testCases.forEach(({ received, required, expected }) => {
      const { unmount } = render(
        <ProposalTimeline
          {...baseProps}
          approvalsReceived={received}
          approvalsRequired={required}
        />
      );
      expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
      unmount();
    });
  });

  it('should not show timelock when not executed and no deadline', () => {
    render(<ProposalTimeline {...baseProps} timelockDeadline={undefined} />);
    expect(screen.queryByText('Timelock Deadline')).not.toBeInTheDocument();
  });

  it('should not show timelock when already executed', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const props: ProposalTimelineProps = {
      ...baseProps,
      isExecuted: true,
      timelockDeadline: futureTimestamp,
    };

    render(<ProposalTimeline {...props} />);
    expect(screen.queryByText('Timelock Deadline')).not.toBeInTheDocument();
  });
});
