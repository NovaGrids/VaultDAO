/**
 * Image and PDF preview component for uploaded files.
 * Mobile responsive with touch support.
 */

import { useState, useEffect } from 'react';
import { FileText, ImageIcon, X } from 'lucide-react';

export interface PreviewFile {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  objectUrl?: string;
}

interface FilePreviewProps {
  file: PreviewFile;
  onRemove?: (id: string) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreview({ file, onRemove, className = '' }: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  useEffect(() => {
    if ((isImage || isPdf) && file.file) {
      const url = file.objectUrl ?? URL.createObjectURL(file.file);
      setPreviewUrl(url);
      return () => {
        if (!file.objectUrl) URL.revokeObjectURL(url);
      };
    }
  }, [file.file, file.objectUrl, isImage, isPdf]);

  const handleRemove = () => {
    if (previewUrl && !file.objectUrl) URL.revokeObjectURL(previewUrl);
    onRemove?.(file.id);
  };

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800/80 ${className}`}
      role="article"
    >
      {onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-red-600/90 text-white opacity-90 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500"
          aria-label={`Remove ${file.name}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center p-4 sm:min-h-[140px]">
        {isImage && previewUrl && !error ? (
          <img
            src={previewUrl}
            alt={file.name}
            className="max-h-32 w-full object-contain object-center sm:max-h-40"
            onError={() => setError('Preview unavailable')}
          />
        ) : isPdf && previewUrl ? (
          <object
            data={previewUrl}
            type="application/pdf"
            className="h-32 w-full sm:h-40"
            title={file.name}
          >
            <FileText className="mx-auto h-12 w-12 text-gray-400" aria-hidden />
          </object>
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            {isImage ? (
              <ImageIcon className="h-12 w-12 sm:h-14 sm:w-14" aria-hidden />
            ) : (
              <FileText className="h-12 w-12 sm:h-14 sm:w-14" aria-hidden />
            )}
            {error && <span className="text-xs">{error}</span>}
          </div>
        )}
      </div>

      <div className="border-t border-gray-700 px-3 py-2">
        <p className="truncate text-sm font-medium text-white" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
      </div>
    </div>
  );
}

export default FilePreview;
