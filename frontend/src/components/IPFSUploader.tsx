/**
 * IPFS upload integration for the proposal creation wizard.
 *
 * - Drag-and-drop via react-dropzone
 * - Uploads to IPFS via ipfs-http-client (VITE_IPFS_API_URL)
 * - Shows per-file progress bars
 * - Validates CID format (CIDv0 Qm… or CIDv1 bafy…)
 * - "Preview" button opens file in a modal via IPFS gateway (VITE_IPFS_GATEWAY)
 * - "Remove" button calls onRemoveAttachment
 * - Caps at MAX_ATTACHMENTS = 10 and shows remaining count
 * - Upload errors surface as toast notifications
 */

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { create } from 'ipfs-http-client';
import {
  Upload,
  FileText,
  Loader2,
  AlertCircle,
  X,
  Eye,
  ExternalLink,
} from 'lucide-react';
import { env } from '../config/env';

// ─── Constants ────────────────────────────────────────────────────────────────

const IPFS_API_URL = import.meta.env.VITE_IPFS_API_URL as string | undefined ?? '';
export const MAX_ATTACHMENTS = 10;

// CIDv0: starts with "Qm" and is 46 chars; CIDv1: starts with "bafy" and is 59+ chars
const CID_V0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_RE = /^bafy[a-z2-7]{55,}$/i;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IPFSUploadResult {
  cid: string;
  name: string;
  size: number;
  path: string;
}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  percent: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  cid?: string;
  error?: string;
}

interface IPFSUploaderProps {
  /** Already-committed attachments (shown with Remove button) */
  existingAttachments?: Array<{ cid: string; name: string }>;
  /** Called when user removes an existing attachment */
  onRemoveAttachment?: (cid: string) => void;
  /** Called when a new file is successfully uploaded and its CID validated */
  onUploadComplete?: (result: IPFSUploadResult) => void;
  /** Toast callback for upload errors */
  onError?: (message: string) => void;
  maxFiles?: number;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
  if (!IPFS_API_URL) return null;
  try {
    return create({ url: IPFS_API_URL });
  } catch {
    return null;
  }
}

/**
 * Validate a CID string: accepts CIDv0 (Qm…) or CIDv1 (bafy…).
 */
export function validateCID(cid: string): boolean {
  return CID_V0_RE.test(cid) || CID_V1_RE.test(cid);
}

/**
 * Upload a single file to IPFS and return the result.
 * Throws on failure.
 */
export async function uploadToIPFS(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<IPFSUploadResult | null> {
  const client = getClient();
  if (!client) return null;

  onProgress?.(10);
  const result = await client.add(file, {
    progress: (bytes: number) =>
      onProgress?.(Math.min(90, Math.round((bytes / file.size) * 90))),
  });
  onProgress?.(100);

  return {
    cid: result.cid.toString(),
    name: file.name,
    size: result.size,
    path: result.path,
  };
}

/**
 * Upload multiple files with per-file progress tracking.
 */
export async function uploadMultipleToIPFS(
  files: File[],
  onProgress?: (progress: UploadProgress[]) => void,
): Promise<IPFSUploadResult[]> {
  const results: IPFSUploadResult[] = [];
  const progressMap = new Map<string, UploadProgress>();

  const update = (fileId: string, patch: Partial<UploadProgress>) => {
    progressMap.set(fileId, { ...progressMap.get(fileId)!, ...patch });
    onProgress?.(Array.from(progressMap.values()));
  };

  const client = getClient();
  if (!client) return results;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileId = `${file.name}-${file.size}-${i}`;
    progressMap.set(fileId, { fileId, fileName: file.name, percent: 0, status: 'pending' });
    onProgress?.(Array.from(progressMap.values()));
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileId = `${file.name}-${file.size}-${i}`;
    update(fileId, { status: 'uploading', percent: 0 });

    try {
      const result = await client.add(file, {
        progress: (bytes: number) =>
          update(fileId, { percent: Math.min(100, Math.round((bytes / file.size) * 100)) }),
      });
      update(fileId, { status: 'done', percent: 100, cid: result.cid.toString() });
      results.push({ cid: result.cid.toString(), name: file.name, size: result.size, path: result.path });
    } catch (err) {
      update(fileId, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' });
      throw err;
    }
  }

  return results;
}

/** Returns true when VITE_IPFS_API_URL is set. */
export function isIPFSConfigured(): boolean {
  return Boolean(IPFS_API_URL);
}

/** Build a gateway URL for a CID. */
export function gatewayUrl(cid: string): string {
  const base = env.ipfsGateway.endsWith('/') ? env.ipfsGateway : `${env.ipfsGateway}/`;
  return `${base}${cid}`;
}

// ─── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  cid: string;
  name: string;
  onClose: () => void;
}

function PreviewModal({ cid, name, onClose }: PreviewModalProps) {
  const url = gatewayUrl(cid);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <p className="text-sm font-medium text-white truncate max-w-[70%]" title={name}>
            {name}
          </p>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open
            </a>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close preview"
            >
              <X className="h-4 w-4 text-gray-400" aria-hidden />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0">
          <iframe
            src={url}
            title={`Preview of ${name}`}
            className="w-full h-full min-h-[60vh]"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>

        {/* CID footer */}
        <div className="px-4 py-2 border-t border-gray-700 shrink-0">
          <p className="text-xs text-gray-500 font-mono truncate" title={cid}>
            CID: {cid}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function IPFSUploader({
  existingAttachments = [],
  onRemoveAttachment,
  onUploadComplete,
  onError,
  maxFiles = MAX_ATTACHMENTS,
  className = '',
}: IPFSUploaderProps) {
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ cid: string; name: string } | null>(null);

  const totalUsed = existingAttachments.length;
  const remaining = maxFiles - totalUsed;

  const handleError = useCallback(
    (msg: string) => {
      setError(msg);
      onError?.(msg);
    },
    [onError],
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!isIPFSConfigured()) {
        handleError('IPFS API not configured. Set VITE_IPFS_API_URL environment variable.');
        return;
      }

      if (remaining <= 0) {
        handleError(`Maximum ${maxFiles} attachments allowed.`);
        return;
      }

      const toProcess = acceptedFiles.slice(0, remaining);
      setError(null);
      setUploading(true);

      for (const file of toProcess) {
        const fileId = `${file.name}-${file.size}-${Date.now()}`;
        setUploadProgress((prev) => ({ ...prev, [fileId]: 0 }));

        try {
          const result = await uploadToIPFS(file, (pct) =>
            setUploadProgress((prev) => ({ ...prev, [fileId]: pct })),
          );

          if (!result) {
            handleError(`Upload failed for ${file.name}: IPFS client unavailable.`);
            continue;
          }

          if (!validateCID(result.cid)) {
            handleError(`Invalid CID returned for ${file.name}: "${result.cid}"`);
            continue;
          }

          onUploadComplete?.(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          handleError(`Failed to upload ${file.name}: ${msg}`);
        } finally {
          setUploadProgress((prev) => {
            const next = { ...prev };
            delete next[fileId];
            return next;
          });
        }
      }

      setUploading(false);
    },
    [remaining, maxFiles, handleError, onUploadComplete],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: uploading || remaining <= 0,
    multiple: true,
    onDropRejected: (rejections) => {
      const msg = rejections[0]?.errors?.[0]?.message ?? 'File rejected';
      handleError(msg);
    },
  });

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={[
          'flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2',
          'rounded-xl border-2 border-dashed p-4 transition-colors',
          isDragActive
            ? 'border-purple-500 bg-purple-500/10'
            : 'border-gray-600 bg-gray-800/50 hover:border-purple-500/60 hover:bg-gray-800/80',
          uploading || remaining <= 0 ? 'cursor-not-allowed opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="File upload area"
      >
        <input {...getInputProps()} aria-label="Upload files" />
        {uploading ? (
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" aria-hidden />
        ) : (
          <Upload className="h-8 w-8 text-gray-400" aria-hidden />
        )}
        <p className="text-center text-sm text-gray-300">
          {isDragActive ? 'Drop files here' : 'Drag and drop files here, or click to select'}
        </p>
        <p className="text-xs text-gray-500">
          {remaining > 0
            ? `${totalUsed}/${maxFiles} used — ${remaining} remaining`
            : `Maximum ${maxFiles} attachments reached`}
        </p>
      </div>

      {/* IPFS not configured notice */}
      {!isIPFSConfigured() && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-amber-400">IPFS Not Configured</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              Set <code className="font-mono">VITE_IPFS_API_URL</code> to enable file uploads.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400"
          role="alert"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* Per-file progress bars */}
      {Object.entries(uploadProgress).map(([fileId, percent]) => (
        <div key={fileId} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Uploading…</span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full bg-purple-500 transition-all duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ))}

      {/* Existing attachments */}
      {existingAttachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Attachments
          </p>
          {existingAttachments.map((att) => (
            <div
              key={att.cid}
              className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-gray-400 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate" title={att.name}>
                    {att.name}
                  </p>
                  <p className="text-xs text-gray-500 font-mono truncate" title={att.cid}>
                    {att.cid.slice(0, 20)}…
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewTarget(att)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                  aria-label={`Preview ${att.name}`}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  Preview
                </button>
                {onRemoveAttachment && (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(att.cid)}
                    className="p-1.5 rounded hover:bg-red-500/20 transition-colors"
                    aria-label={`Remove ${att.name}`}
                  >
                    <X className="h-4 w-4 text-red-400" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewTarget && (
        <PreviewModal
          cid={previewTarget.cid}
          name={previewTarget.name}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
