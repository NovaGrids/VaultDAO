/**
 * Tests for IPFSUploader component and helpers.
 *
 * Covers:
 * - validateCID: accepts valid CIDv0/CIDv1, rejects invalid strings
 * - File upload returns CID and calls onUploadComplete
 * - Invalid CID from upload is rejected (onError called, onUploadComplete not called)
 * - Preview modal opens when "Preview" button is clicked
 * - MAX_ATTACHMENTS cap is enforced
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import IPFSUploader, { validateCID, MAX_ATTACHMENTS } from '../IPFSUploader';

// ─── Mock ipfs-http-client ────────────────────────────────────────────────────

const mockAdd = vi.fn();
vi.mock('ipfs-http-client', () => ({
  create: () => ({ add: mockAdd }),
}));

// ─── Mock env ─────────────────────────────────────────────────────────────────

vi.mock('../../config/env', () => ({
  env: {
    ipfsGateway: 'https://ipfs.io/ipfs/',
    contractId: 'CTEST',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    stellarNetwork: 'TESTNET',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    feesAccount: 'GFEES',
  },
}));

// Set VITE_IPFS_API_URL so isIPFSConfigured() returns true
vi.stubEnv('VITE_IPFS_API_URL', 'http://localhost:5001');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const VALID_CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const INVALID_CID = 'not-a-cid';

// ─── validateCID ──────────────────────────────────────────────────────────────

describe('validateCID', () => {
  it('accepts a valid CIDv0 (Qm…)', () => {
    expect(validateCID(VALID_CID_V0)).toBe(true);
  });

  it('accepts a valid CIDv1 (bafy…)', () => {
    expect(validateCID(VALID_CID_V1)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateCID('')).toBe(false);
  });

  it('rejects a random string', () => {
    expect(validateCID(INVALID_CID)).toBe(false);
  });

  it('rejects a CIDv0 that is too short', () => {
    expect(validateCID('QmShort')).toBe(false);
  });

  it('rejects a string starting with Qm but wrong length', () => {
    expect(validateCID('Qm' + 'a'.repeat(10))).toBe(false);
  });
});

// ─── IPFSUploader component ───────────────────────────────────────────────────

describe('IPFSUploader component', () => {
  const onUploadComplete = vi.fn();
  const onError = vi.fn();
  const onRemoveAttachment = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drop zone', () => {
    render(
      <IPFSUploader
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );
    expect(screen.getByLabelText('File upload area')).toBeInTheDocument();
  });

  it('calls onUploadComplete with valid CID after successful upload', async () => {
    mockAdd.mockResolvedValueOnce({
      cid: { toString: () => VALID_CID_V0 },
      size: 1024,
      path: VALID_CID_V0,
    });

    render(
      <IPFSUploader
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText('Upload files');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalledWith(
        expect.objectContaining({ cid: VALID_CID_V0, name: 'test.txt' }),
      );
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError and does NOT call onUploadComplete when CID is invalid', async () => {
    mockAdd.mockResolvedValueOnce({
      cid: { toString: () => INVALID_CID },
      size: 512,
      path: INVALID_CID,
    });

    render(
      <IPFSUploader
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText('Upload files');
    const file = new File(['data'], 'bad.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining('Invalid CID'),
      );
    });
    expect(onUploadComplete).not.toHaveBeenCalled();
  });

  it('calls onError when upload throws', async () => {
    mockAdd.mockRejectedValueOnce(new Error('Network error'));

    render(
      <IPFSUploader
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    const input = screen.getByLabelText('Upload files');
    const file = new File(['data'], 'fail.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining('Network error'),
      );
    });
  });

  it('opens preview modal when "Preview" button is clicked', () => {
    render(
      <IPFSUploader
        existingAttachments={[{ cid: VALID_CID_V0, name: 'invoice.pdf' }]}
        onRemoveAttachment={onRemoveAttachment}
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    const previewBtn = screen.getByRole('button', { name: /preview invoice\.pdf/i });
    fireEvent.click(previewBtn);

    expect(screen.getByRole('dialog', { name: /preview: invoice\.pdf/i })).toBeInTheDocument();
    expect(screen.getByTitle(`Preview of invoice.pdf`)).toBeInTheDocument();
  });

  it('closes preview modal on Escape / clicking backdrop', () => {
    render(
      <IPFSUploader
        existingAttachments={[{ cid: VALID_CID_V0, name: 'doc.pdf' }]}
        onRemoveAttachment={onRemoveAttachment}
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview doc\.pdf/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onRemoveAttachment when Remove button is clicked', () => {
    render(
      <IPFSUploader
        existingAttachments={[{ cid: VALID_CID_V0, name: 'receipt.pdf' }]}
        onRemoveAttachment={onRemoveAttachment}
        onUploadComplete={onUploadComplete}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove receipt\.pdf/i }));
    expect(onRemoveAttachment).toHaveBeenCalledWith(VALID_CID_V0);
  });

  it('enforces MAX_ATTACHMENTS cap and shows error when full', async () => {
    const fullAttachments = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({
      cid: `Qm${'a'.repeat(44 - String(i).length)}${i}`,
      name: `file-${i}.txt`,
    }));

    render(
      <IPFSUploader
        existingAttachments={fullAttachments}
        onUploadComplete={onUploadComplete}
        onError={onError}
        maxFiles={MAX_ATTACHMENTS}
      />,
    );

    // Drop zone should be disabled (remaining = 0)
    expect(screen.getByText(`Maximum ${MAX_ATTACHMENTS} attachments reached`)).toBeInTheDocument();

    // Attempting to drop should trigger error
    const input = screen.getByLabelText('Upload files');
    const file = new File(['x'], 'extra.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining(`Maximum ${MAX_ATTACHMENTS}`),
      );
    });
    expect(onUploadComplete).not.toHaveBeenCalled();
  });

  it('shows remaining count correctly', () => {
    render(
      <IPFSUploader
        existingAttachments={[{ cid: VALID_CID_V0, name: 'a.pdf' }]}
        onUploadComplete={onUploadComplete}
        onError={onError}
        maxFiles={MAX_ATTACHMENTS}
      />,
    );

    expect(
      screen.getByText(`1/${MAX_ATTACHMENTS} used — ${MAX_ATTACHMENTS - 1} remaining`),
    ).toBeInTheDocument();
  });
});
