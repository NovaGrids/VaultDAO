/**
 * IPFS upload integration. Uploads files and returns CIDs.
 * Configure VITE_IPFS_API_URL for your IPFS HTTP API (e.g. local node or Infura).
 */

import { create } from 'ipfs-http-client';

const IPFS_API_URL = import.meta.env.VITE_IPFS_API_URL || '';

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

function getClient() {
  if (!IPFS_API_URL) return null;
  try {
    return create({ url: IPFS_API_URL });
  } catch {
    return null;
  }
}

/**
 * Upload a single file to IPFS.
 */
export async function uploadToIPFS(
  file: File,
  onProgress?: (percent: number) => void
): Promise<IPFSUploadResult | null> {
  const client = getClient();
  if (!client) {
    return null;
  }

  try {
    onProgress?.(10);
    const result = await client.add(file, { progress: (bytes) => onProgress?.(Math.min(90, (bytes / file.size) * 90)) });
    onProgress?.(100);
    return {
      cid: result.cid.toString(),
      name: file.name,
      size: result.size,
      path: result.path,
    };
  } catch (err) {
    console.error('IPFS upload failed:', err);
    throw err;
  }
}

/**
 * Upload multiple files to IPFS with progress tracking.
 */
export async function uploadMultipleToIPFS(
  files: File[],
  onProgress?: (progress: UploadProgress[]) => void
): Promise<IPFSUploadResult[]> {
  const results: IPFSUploadResult[] = [];
  const progressMap = new Map<string, UploadProgress>();

  const updateProgress = (fileId: string, update: Partial<UploadProgress>) => {
    const prev = progressMap.get(fileId);
    progressMap.set(fileId, { ...prev!, ...update });
    onProgress?.(Array.from(progressMap.values()));
  };

  const client = getClient();
  if (!client) {
    return results;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileId = `${file.name}-${file.size}-${i}`;
    progressMap.set(fileId, {
      fileId,
      fileName: file.name,
      percent: 0,
      status: 'pending',
    });
    onProgress?.(Array.from(progressMap.values()));
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileId = `${file.name}-${file.size}-${i}`;
    updateProgress(fileId, { status: 'uploading', percent: 0 });

    try {
      const result = await client.add(file, {
        progress: (bytes) => {
          const pct = Math.min(100, Math.round((bytes / file.size) * 100));
          updateProgress(fileId, { percent: pct });
        },
      });
      updateProgress(fileId, {
        status: 'done',
        percent: 100,
        cid: result.cid.toString(),
      });
      results.push({
        cid: result.cid.toString(),
        name: file.name,
        size: result.size,
        path: result.path,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      updateProgress(fileId, {
        status: 'error',
        error: msg,
      });
      throw err;
    }
  }

  return results;
}

/**
 * Check if IPFS API is configured.
 */
export function isIPFSConfigured(): boolean {
  return Boolean(IPFS_API_URL);
}
