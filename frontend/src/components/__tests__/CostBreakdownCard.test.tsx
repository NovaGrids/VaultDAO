import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CostBreakdownCard from '../CostBreakdownCard';
import type { CostBreakdown } from '../CostBreakdownCard';

const baseBreakdown: CostBreakdown = {
  feeXLM: '0.0000110',
  baseFee: '0.0000100',
  resourceFee: '0.0000010',
  cpuInsns: '500000',
  memBytes: '32768',
  ledgerReads: 3,
  ledgerWrites: 2,
};

describe('CostBreakdownCard', () => {
  it('renders fee breakdown fields', () => {
    render(
      <CostBreakdownCard
        breakdown={baseBreakdown}
        highFeeThreshold={0.01}
      />
    );

    expect(screen.getByText('0.0000110')).toBeTruthy();
    expect(screen.getByText('0.0000100 XLM')).toBeTruthy();
    expect(screen.getByText('0.0000010 XLM')).toBeTruthy();
    expect(screen.getByText('500,000')).toBeTruthy();
    expect(screen.getByText('32,768 B')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('does not show high-cost warning when fee is below threshold', () => {
    render(
      <CostBreakdownCard
        breakdown={baseBreakdown}
        highFeeThreshold={0.01}
      />
    );

    expect(screen.queryByText(/High Cost Transaction/i)).toBeNull();
  });

  it('shows high-cost warning when fee exceeds threshold', () => {
    const expensive: CostBreakdown = { ...baseBreakdown, feeXLM: '0.0500000' };
    render(
      <CostBreakdownCard
        breakdown={expensive}
        highFeeThreshold={0.01}
      />
    );

    expect(screen.getByText(/High Cost Transaction/i)).toBeTruthy();
  });

  it('shows "Add 20% buffer" button when onAddBuffer is provided', () => {
    const onAddBuffer = vi.fn();
    render(
      <CostBreakdownCard
        breakdown={baseBreakdown}
        highFeeThreshold={0.01}
        onAddBuffer={onAddBuffer}
      />
    );

    const btn = screen.getByRole('button', { name: /Add 20% buffer/i });
    expect(btn).toBeTruthy();
  });

  it('calls onAddBuffer when buffer button is clicked', () => {
    const onAddBuffer = vi.fn();
    render(
      <CostBreakdownCard
        breakdown={baseBreakdown}
        highFeeThreshold={0.01}
        onAddBuffer={onAddBuffer}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Add 20% buffer/i }));
    expect(onAddBuffer).toHaveBeenCalledTimes(1);
  });

  it('shows buffered fee and hides buffer button when bufferApplied is true', () => {
    const withBuffer: CostBreakdown = {
      ...baseBreakdown,
      bufferedFeeXLM: '0.0000132',
    };
    render(
      <CostBreakdownCard
        breakdown={withBuffer}
        highFeeThreshold={0.01}
        bufferApplied
      />
    );

    expect(screen.getByText('0.0000132')).toBeTruthy();
    expect(screen.getByText('+20% buffer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add 20% buffer/i })).toBeNull();
  });

  it('shows high-cost warning based on buffered fee when buffer is applied', () => {
    const withBuffer: CostBreakdown = {
      ...baseBreakdown,
      feeXLM: '0.0000110',
      bufferedFeeXLM: '0.0500000',
    };
    render(
      <CostBreakdownCard
        breakdown={withBuffer}
        highFeeThreshold={0.01}
        bufferApplied
      />
    );

    expect(screen.getByText(/High Cost Transaction/i)).toBeTruthy();
  });
});
