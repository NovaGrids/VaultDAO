/**
 * Tests for AdvancedProposalFilter
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdvancedProposalFilter from '../AdvancedProposalFilter';

vi.useFakeTimers();

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function renderFilter(onFilterChange = vi.fn()) {
  return render(
    <MemoryRouter>
      <AdvancedProposalFilter onFilterChange={onFilterChange} availableTags={['governance', 'treasury']} proposalCount={10} />
    </MemoryRouter>
  );
}

describe('AdvancedProposalFilter', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('renders toggle button with no badge when no filters active', () => {
    renderFilter();
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
    // No badge number visible
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('opens filter panel on toggle click', () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
  });

  it('filter by status updates active count badge', async () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    // Badge should show 1
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
  });

  it('calls onFilterChange after debounce when status selected', async () => {
    const onChange = vi.fn();
    renderFilter(onChange);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    vi.runAllTimers();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ statuses: ['Approved'] })
      );
    });
  });

  it('clear all resets filters and calls onFilterChange with defaults', async () => {
    const onChange = vi.fn();
    renderFilter(onChange);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    vi.runAllTimers();
    // Now clear
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    vi.runAllTimers();
    await waitFor(() => {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.statuses).toEqual([]);
    });
  });

  it('save search button appears when filters are active', async () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    vi.runAllTimers();
    await waitFor(() => expect(screen.getByRole('button', { name: /save search/i })).toBeInTheDocument());
  });

  it('saves a search to localStorage', async () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    vi.runAllTimers();
    await waitFor(() => screen.getByRole('button', { name: /save search/i }));
    fireEvent.click(screen.getByRole('button', { name: /save search/i }));
    const input = screen.getByPlaceholderText(/search name/i);
    fireEvent.change(input, { target: { value: 'My pending filter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const stored = localStorageMock.getItem('vaultdao_saved_searches');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)[0].name).toBe('My pending filter');
  });
});
