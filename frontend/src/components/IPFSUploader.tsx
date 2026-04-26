/**
 * IPFS upload integration. Uploads files and returns CIDs.
 * Configure VITE_IPFS_API_URL for your IPFS HTTP API (e.g. local node or Infura).
 */

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { create } from 'ipfs-http-client';
import { Upload, FileText, Loader2, AlertCircle, Copy, X, CheckCircle } from 'lucide-react';

const IPFS_API_URL = import.meta.env.VITE_IPFS_API_URL || '';
const MIN_ATTACHMENT_LEN = 46;
const MAX_ATTACHMENT_LEN = 128;
const MAX_ATTACHMENTS = 10;

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
  proposalId?: string;
  onAttachToProposal?: (proposalId: string, cid: string) => Promise<void>;
  existingAttachments?: Array<{ cid: string; name: string }>;
  onRemoveAttachment?: (cid: string) => void;
  maxFiles?: number;
  className?: string;
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
    const result = await client.add(file, { progress: (bytes: number) => onProgress?.(Math.min(90, (bytes / file.size) * 90)) });
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
        progress: (bytes: number) => {
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

export default function IPFSUploader({ 
  proposalId, 
  onAttachToProposal, 
  existingAttachments = [], 
  onRemoveAttachment,
  maxFiles = MAX_ATTACHMENTS,
  className = ''
}: IPFSUploaderProps) {
  const [uploadResults, setUploadResults] = useState<IPFSUploadResult[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);

  const validateCID = (cid: string): boolean => {
    return cid.length >= MIN_ATTACHMENT_LEN && cid.length <= MAX_ATTACHMENT_LEN;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!isIPFSConfigured()) {
      setError('IPFS API not configured. Set VITE_IPFS_API_URL environment variable.');
      return;
    }

    if (existingAttachments.length + uploadResults.length + acceptedFiles.length > maxFiles) {
      setError(`Maximum ${maxFiles} attachments allowed.`);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const newResults: IPFSUploadResult[] = [];
      
      for (const file of acceptedFiles) {
        const fileId = `${file.name}-${file.size}-${Date.now()}`;
        setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));
        
        try {
          const result = await uploadToIPFS(file, (percent) => {
            setUploadProgress(prev => ({ ...prev, [fileId]: percent }));
          });
          
          if (result && validateCID(result.cid)) {
            newResults.push(result);
          } else {
            setError(`Invalid CID length for ${file.name}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setError(`Failed to upload ${file.name}: ${msg}`);
        }
      }
      
      setUploadResults(prev => [...prev, ...newResults]);
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  }, [existingAttachments.length, uploadResults.length, maxFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: uploading,
    maxFiles: maxFiles - existingAttachments.length - uploadResults.length,
    multiple: true,
  });

  const handleCopyCID = async (cid: string) => {
    try {
      await navigator.clipboard.writeText(cid);
      setCopiedCid(cid);
      setTimeout(() => setCopiedCid(null), 2000);
    } catch (err) {
      setError('Failed to copy CID');
    }
  };

  const handleAttachToProposal = async (cid: string) => {
    if (!proposalId || !onAttachToProposal) return;
    
    if (!validateCID(cid)) {
      setError('Invalid CID length');
      return;
    }

    setAttaching(cid);
    try {
      await onAttachToProposal(proposalId, cid);
      setUploadResults(prev => prev.filter(r => r.cid !== cid));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to attach';
      setError(msg);
    } finally {
      setAttaching(null);
    }
  };

  const handleRemoveUpload = (cid: string) => {
    setUploadResults(prev => prev.filter(r => r.cid !== cid));
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Warning Banner */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">IPFS Upload Notice</p>
            <p className="text-xs text-amber-400/80 mt-1">
              Files will be uploaded to IPFS and stored permanently. CIDs must be {MIN_ATTACHMENT_LEN}-{MAX_ATTACHMENT_LEN} characters.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={`
          flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-colors
          ${isDragActive ? 'border-purple-500 bg-purple-500/10' : 'border-gray-600 bg-gray-800/50 hover:border-purple-500/60 hover:bg-gray-800/80'}
          ${uploading ? 'cursor-not-allowed opacity-60' : ''}
        `}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        ) : (
          <Upload className="h-8 w-8 text-gray-400" />
        )}
        <p className="text-center text-sm text-gray-300">
          {isDragActive ? 'Drop files here' : 'Drag and drop files here, or click to select'}
        </p>
        <p className="text-xs text-gray-500">
          {existingAttachments.length + uploadResults.length}/{maxFiles} files used
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Upload Progress */}
      {Object.entries(uploadProgress).map(([fileId, percent]) => (
        <div key={fileId} className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Uploading...</span>
            <span className="text-gray-400">{percent}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple-500 transition-all duration-300" 
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ))}

      {/* Uploaded Files */}
      {uploadResults.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Uploaded Files</h3>
          {uploadResults.map((result) => (
            <div key={result.cid} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{result.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-1">{result.cid}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {(result.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleCopyCID(result.cid)}
                    className="p-1.5 rounded hover:bg-gray-700 transition-colors"
                    title="Copy CID"
                  >
                    {copiedCid === result.cid ? (
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                  {proposalId && onAttachToProposal && (
                    <button
                      onClick={() => handleAttachToProposal(result.cid)}
                      disabled={attaching === result.cid}
                      className="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      {attaching === result.cid ? 'Attaching...' : 'Attach'}
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveUpload(result.cid)}
                    className="p-1.5 rounded hover:bg-gray-700 transition-colors"
                    title="Remove"
                  >
                    <X className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Existing Attachments */}
      {existingAttachments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Existing Attachments</h3>
          {existingAttachments.map((attachment) => (
            <div key={attachment.cid} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{attachment.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{attachment.cid}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleCopyCID(attachment.cid)}
                    className="p-1.5 rounded hover:bg-gray-700 transition-colors"
                    title="Copy CID"
                  >
                    {copiedCid === attachment.cid ? (
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                  {onRemoveAttachment && (
                    <button
                      onClick={() => onRemoveAttachment(attachment.cid)}
                      className="p-1.5 rounded hover:bg-gray-700 transition-colors"
                      title="Remove attachment"
                    >
                      <X className="h-4 w-4 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isIPFSConfigured() && (
        <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-white">IPFS Not Configured</p>
              <p className="text-xs text-gray-400 mt-1">
                Set VITE_IPFS_API_URL environment variable to enable file uploads.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
