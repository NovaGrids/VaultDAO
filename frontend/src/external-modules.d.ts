declare module '@albedo-link/intent' {
  const albedo: {
    publicKey: (args: { token: string }) => Promise<{ pubkey?: string; network?: string }>;
    tx: (args: { xdr: string; network?: string; submit?: boolean }) => Promise<{ signed_envelope_xdr?: string }>;
  };
  export default albedo;
}

declare module 'react-dropzone' {
  export function useDropzone(options?: Record<string, unknown>): {
    getRootProps: () => Record<string, unknown>;
    getInputProps: () => Record<string, unknown>;
    isDragActive: boolean;
  };
}

declare module 'browser-image-compression' {
  export default function imageCompression(file: File, options?: Record<string, unknown>): Promise<File>;
}

declare module 'ipfs-http-client' {
  export function create(options?: Record<string, unknown>): {
    add: (
      file: File,
      options?: { progress?: (bytes: number) => void }
    ) => Promise<{ cid: { toString(): string }; size: number; path: string }>;
  };
}
