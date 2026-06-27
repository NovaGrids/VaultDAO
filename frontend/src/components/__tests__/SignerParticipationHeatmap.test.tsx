import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignerParticipationHeatmap, { type FetchSignerParticipationScore } from '../SignerParticipationHeatmap';

const signers = ['GA111', 'GB222'];

function makeFetcher(points: Array<{ date: string; count: number }>): FetchSignerParticipationScore {
  return vi.fn().mockResolvedValue({ signer: signers[0], points });
}

describe('SignerParticipationHeatmap', () => {
  it('renders 52x7 heatmap cells', async () => {
    const fetcher = makeFetcher([]);

    render(<SignerParticipationHeatmap signerAddresses={signers} fetcher={fetcher} />);

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(screen.getAllByTestId('heatmap-cell')).toHaveLength(364);
  });

  it('shows empty-state message when no votes exist', async () => {
    render(<SignerParticipationHeatmap signerAddresses={signers} fetcher={makeFetcher([])} />);

    expect(await screen.findByText(/no votes found in the selected range/i)).toBeInTheDocument();
    const oneCell = screen.getAllByTestId('heatmap-cell')[0];
    expect(oneCell.getAttribute('title')).toMatch(/votes on/i);
  });

  it('exposes responsive horizontal scroll wrapper', () => {
    render(<SignerParticipationHeatmap signerAddresses={signers} fetcher={makeFetcher([])} />);

    const wrapper = screen.getByTestId('heatmap-scroll-wrapper');
    expect(wrapper.className).toContain('overflow-x-auto');
  });

  it('changes date range and re-fetches participation score', async () => {
    const fetcher = makeFetcher([]);
    render(<SignerParticipationHeatmap signerAddresses={signers} fetcher={fetcher} />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '90d' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('renders signer-empty state when list is empty', () => {
    render(<SignerParticipationHeatmap signerAddresses={[]} fetcher={makeFetcher([])} />);

    expect(screen.getByText(/no signer addresses available/i)).toBeInTheDocument();
  });
});
