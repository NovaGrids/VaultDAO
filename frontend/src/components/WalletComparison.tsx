/**
 * Wallet comparison table - features across Freighter, Albedo, Rabet.
 * Mobile responsive.
 */

import { useWalletProviderInfo } from './WalletProviders';
import { ExternalLink } from 'lucide-react';

const COMPARISON: Record<string, { extension: boolean; web: boolean; mobile: boolean; multisig: boolean }> = {
  freighter: { extension: true, web: false, mobile: true, multisig: true },
  albedo: { extension: false, web: true, mobile: true, multisig: true },
  rabet: { extension: true, web: false, mobile: true, multisig: false },
};

export function WalletComparison() {
  const { providers, loading } = useWalletProviderInfo();

  if (loading) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/80">
      <table className="w-full min-w-[320px] text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="px-4 py-3 text-left font-medium text-gray-300">Wallet</th>
            <th className="px-4 py-3 text-center font-medium text-gray-300">Extension</th>
            <th className="px-4 py-3 text-center font-medium text-gray-300">Web</th>
            <th className="px-4 py-3 text-center font-medium text-gray-300">Mobile</th>
            <th className="px-4 py-3 text-center font-medium text-gray-300">Multisig</th>
            <th className="px-4 py-3 text-center font-medium text-gray-300">Status</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const features = COMPARISON[p.id] ?? { extension: false, web: false, mobile: false, multisig: false };
            return (
              <tr key={p.id} className="border-b border-gray-700/50 last:border-0">
                <td className="px-4 py-3">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 font-medium text-white hover:text-purple-400"
                  >
                    {p.name}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </td>
                <td className="px-4 py-3 text-center">{features.extension ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-center">{features.web ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-center">{features.mobile ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-center">{features.multisig ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-center">
                  {p.available ? (
                    <span className="text-green-400">Available</span>
                  ) : (
                    <span className="text-gray-500">Not detected</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default WalletComparison;
