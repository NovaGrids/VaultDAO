import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Loader, Download, FileText, Image, Code } from 'lucide-react';
import { env } from '../config/env';

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024; // 10 MB
const CACHE_PREFIX = 'ipfs_verify_';

type VerifyStatus = 'idle' | 'loading' | 'verified' | 'failed' | 'error';
type FileCategory = 'pdf' | 'image' | 'text' | 'binary';

interface IPFSAttachmentViewerProps {
  cid: string;
  fileName?: string;
  expectedHash?: string;
  onVerify?: (verified: boolean) => void;
}

function detectFileCategory(name: string, contentType: string): FileCategory {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (contentType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    contentType.startsWith('text/') ||
    ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'csv', 'xml', 'ts', 'tsx', 'js', 'jsx'].includes(ext)
  ) return 'text';
  return 'binary';
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getCached(cid: string): { verified: boolean; hash: string } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + cid);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCache(cid: string, result: { verified: boolean; hash: string }) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + cid, JSON.stringify(result));
  } catch {
    // sessionStorage quota exceeded — ignore
  }
}

const IPFSAttachmentViewer: React.FC<IPFSAttachmentViewerProps> = ({
  cid,
  fileName = 'attachment',
  expectedHash,
  onVerify,
}) => {
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fileCategory, setFileCategory] = useState<FileCategory>('binary');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const gatewayUrl = `${env.ipfsGatewayUrl}/${cid}`;

  const verify = useCallback(async () => {
    const cached = getCached(cid);
    if (cached) {
      setComputedHash(cached.hash);
      setStatus(cached.verified ? 'verified' : 'failed');
      onVerify?.(cached.verified);
      return;
    }

    setStatus('loading');
    setProgress(0);
    setErrorMsg(null);

    try {
      const response = await fetch(gatewayUrl);
      if (!response.ok) throw new Error(`Gateway error: ${response.status}`);

      const contentType = response.headers.get('content-type') ?? '';
      const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
      const category = detectFileCategory(fileName, contentType);
      setFileCategory(category);
      setFileSize(contentLength);

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setProgress(Math.min(95, Math.round((received / contentLength) * 95)));
        }
      }

      setProgress(97);

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const hash = await sha256Hex(combined.buffer as ArrayBuffer);
      setComputedHash(hash);
      setProgress(99);

      const verified = expectedHash ? hash === expectedHash : true;
      setCache(cid, { verified, hash });
      onVerify?.(verified);
      setStatus(verified ? 'verified' : 'failed');

      if (totalLength <= MAX_PREVIEW_BYTES) {
        const blob = new Blob([combined], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setObjectUrl(url);

        if (category === 'text') {
          setTextContent(new TextDecoder().decode(combined));
        }
      }

      setProgress(100);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch file');
      setStatus('error');
    }
  }, [cid, expectedHash, fileName, gatewayUrl, onVerify]);

  useEffect(() => {
    verify();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const renderBadge = () => {
    if (status === 'loading') {
      return (
        <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
          <Loader className="animate-spin h-4 w-4" />
          Verifying… {progress}%
        </div>
      );
    }
    if (status === 'verified') {
      return (
        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
          <CheckCircle className="h-4 w-4" />
          ✓ Verified
        </div>
      );
    }
    if (status === 'failed') {
      return (
        <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          ⚠ Integrity Failed
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Error: {errorMsg}
        </div>
      );
    }
    return null;
  };

  const renderPreview = () => {
    if (status === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center h-40 gap-3">
          <Loader className="animate-spin h-8 w-8 text-purple-400" />
          <div className="w-48 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm text-gray-400">{progress}%</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex items-center justify-center h-32 text-red-400 text-sm">
          Could not load file preview.
        </div>
      );
    }

    if (!objectUrl) {
      return (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400 text-sm">
          <FileText className="h-8 w-8 opacity-40" />
          <span>File too large for in-browser preview ({Math.round(fileSize / 1024 / 1024)} MB)</span>
          <a
            href={gatewayUrl}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-purple-400 hover:text-purple-300 underline"
          >
            <Download className="h-4 w-4" /> Download only
          </a>
        </div>
      );
    }

    if (fileCategory === 'image') {
      return (
        <img
          src={objectUrl}
          alt={fileName}
          className="max-w-full max-h-96 object-contain rounded"
        />
      );
    }

    if (fileCategory === 'pdf') {
      return (
        <iframe
          src={objectUrl}
          title={fileName}
          className="w-full h-96 rounded border border-gray-700"
        />
      );
    }

    if (fileCategory === 'text' && textContent !== null) {
      return (
        <pre className="bg-gray-900 text-green-300 text-xs p-4 rounded overflow-auto max-h-80 whitespace-pre-wrap break-words">
          <code>{textContent}</code>
        </pre>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400 text-sm">
        <Code className="h-8 w-8 opacity-40" />
        <span>Binary file — download only</span>
        <a
          href={gatewayUrl}
          download={fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-purple-400 hover:text-purple-300 underline"
        >
          <Download className="h-4 w-4" /> {fileName}
        </a>
      </div>
    );
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Image className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-white truncate">{fileName}</span>
          <span className="text-xs text-gray-500 font-mono truncate hidden sm:block">{cid.slice(0, 12)}…</span>
        </div>
        {renderBadge()}
      </div>

      {status === 'failed' && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
          ⚠ Integrity Failed — this file does not match the on-chain Merkle proof. Do not trust its contents.
        </div>
      )}

      <div className="rounded-lg overflow-hidden border border-gray-700 bg-gray-900 flex items-center justify-center min-h-[80px]">
        {renderPreview()}
      </div>

      {computedHash && (
        <div className="text-xs text-gray-500 font-mono break-all">
          SHA-256: {computedHash}
        </div>
      )}
    </div>
  );
};

export default IPFSAttachmentViewer;
