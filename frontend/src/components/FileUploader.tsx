/**
 * File upload component with drag-and-drop, validation, compression, and IPFS.
 * Mobile responsive with camera capture support.
 */

import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import imageCompression from 'browser-image-compression';
import { Upload, Camera, FileText, Loader2, AlertCircle } from 'lucide-react';
import FilePreview, { type PreviewFile } from './FilePreview';
import { uploadToIPFS, isIPFSConfigured } from './IPFSUploader';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

export interface UploadedAttachment {
  cid: string;
  name: string;
  type: string;
  size: number;
}

interface FileUploaderProps {
  value: UploadedAttachment[];
  onChange: (attachments: UploadedAttachment[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

function compressIfImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return Promise.resolve(file);
  return imageCompression(file, {
    maxSizeMB: 2,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
  }).catch(() => file);
}

export function FileUploader({
  value,
  onChange,
  maxFiles = 10,
  disabled = false,
  className = '',
}: FileUploaderProps) {
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (acceptedFiles: File[]) => {
      setError(null);
      const remaining = maxFiles - files.length - value.length;
      const toAdd = acceptedFiles.slice(0, Math.max(0, remaining));
      if (toAdd.length === 0) {
        setError(`Maximum ${maxFiles} files allowed`);
        return;
      }

      const newPreviewFiles: PreviewFile[] = toAdd.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
      }));

      setFiles((prev) => [...prev, ...newPreviewFiles]);

      if (!isIPFSConfigured()) {
        return;
      }

      setUploading(true);
      const results: UploadedAttachment[] = [];

      for (const pf of newPreviewFiles) {
        try {
          const compressed = await compressIfImage(pf.file);
          setProgress((p) => ({ ...p, [pf.id]: 5 }));
          const result = await uploadToIPFS(compressed, (pct) =>
            setProgress((prev) => ({ ...prev, [pf.id]: pct }))
          );
          if (result) {
            results.push({
              cid: result.cid,
              name: result.name,
              type: compressed.type,
              size: result.size,
            });
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Upload failed');
        }
      }

      setUploading(false);
      setProgress({});
      if (results.length > 0) {
        onChange([...value, ...results]);
        setFiles((prev) => prev.filter((f) => !newPreviewFiles.some((n) => n.id === f.id)));
      }
    },
    [files.length, maxFiles, onChange, value]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: { readonly errors: readonly { message: string }[] }[]) => {
      if (fileRejections.length > 0) {
        const first = fileRejections[0];
        const msg = first?.errors?.[0]?.message ?? 'Invalid file';
        setError(msg);
      }
      if (acceptedFiles.length > 0) {
        processFiles(acceptedFiles);
      }
    },
    [processFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: MAX_SIZE,
    accept: ALLOWED_TYPES,
    maxFiles: maxFiles - files.length - value.length,
    disabled: disabled || uploading,
    noClick: false,
    noKeyboard: false,
  });

  const handleRemoveFile = useCallback(
    (id: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    []
  );

  const handleRemoveAttachment = useCallback(
    (cid: string) => {
      onChange(value.filter((a) => a.cid !== cid));
    },
    [onChange, value]
  );

  const handleCameraClick = () => {
    cameraInputRef.current?.click();
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files;
    if (f && f.length > 0) {
      processFiles(Array.from(f));
    }
    e.target.value = '';
  };

  const totalCount = files.length + value.length;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div
        {...getRootProps()}
        className={`
          flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-colors
          sm:min-h-[160px] sm:p-6
          ${isDragActive ? 'border-purple-500 bg-purple-500/10' : 'border-gray-600 bg-gray-800/50 hover:border-purple-500/60 hover:bg-gray-800/80'}
          ${disabled || uploading ? 'cursor-not-allowed opacity-60' : ''}
        `}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2 className="h-10 w-10 animate-spin text-purple-400 sm:h-12 sm:w-12" aria-hidden />
        ) : (
          <Upload className="h-10 w-10 text-gray-400 sm:h-12 sm:w-12" aria-hidden />
        )}
        <p className="text-center text-sm text-gray-300 sm:text-base">
          {isDragActive
            ? 'Drop files here'
            : 'Drag and drop files here, or click to select'}
        </p>
        <p className="text-xs text-gray-500">
          Images & PDF, max {MAX_SIZE / (1024 * 1024)}MB each
        </p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCameraClick();
          }}
          className="mt-2 flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
        >
          <Camera className="h-4 w-4" aria-hidden />
          Take photo
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraChange}
          className="hidden"
          aria-hidden
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {!isIPFSConfigured() && totalCount > 0 && (
        <p className="text-xs text-amber-400">
          Set VITE_IPFS_API_URL to upload to IPFS. Files are selected but not yet stored.
        </p>
      )}

      {(files.length > 0 || value.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {files.map((pf) => (
            <div key={pf.id} className="relative">
              <FilePreview file={pf} onRemove={handleRemoveFile} />
              {uploading && progress[pf.id] !== undefined && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-700 rounded-b-lg overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{ width: `${progress[pf.id]}%` }}
                  />
                </div>
              )}
            </div>
          ))}
          {value.map((a) => (
            <div
              key={a.cid}
              className="relative flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800/80"
            >
              <button
                type="button"
                onClick={() => handleRemoveAttachment(a.cid)}
                className="absolute right-2 top-2 z-10 rounded-full bg-red-600/90 p-1.5 text-white hover:bg-red-600"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
              <div className="flex flex-1 items-center justify-center p-4">
                <FileText className="h-12 w-12 text-gray-400" aria-hidden />
              </div>
              <div className="border-t border-gray-700 px-3 py-2">
                <p className="truncate text-sm font-medium text-white" title={a.name}>
                  {a.name}
                </p>
                <p className="text-xs text-gray-500">IPFS: {a.cid.slice(0, 12)}...</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FileUploader;
