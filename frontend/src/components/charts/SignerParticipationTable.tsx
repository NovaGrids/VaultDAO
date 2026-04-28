import React from 'react';
import type { SignerRow } from '../../utils/analyticsAggregation';

interface Props {
  data: SignerRow[];
}

const truncateAddr = (addr: string) =>
  addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;

const SignerParticipationTable: React.FC<Props> = ({ data }) => {
  if (data.length === 0) {
    return (
      <p className="text-gray-500 text-sm py-4 text-center">
        No signer activity in this range
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left text-gray-400 font-medium py-2 pr-4">Signer</th>
            <th className="text-right text-gray-400 font-medium py-2 pr-4">Approvals</th>
            <th className="text-right text-gray-400 font-medium py-2">Participation</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.signer} className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
              <td className="py-2.5 pr-4">
                <span className="text-gray-300 font-mono text-xs" title={row.signer}>
                  {truncateAddr(row.signer)}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right text-white font-semibold">
                {row.approvals}
              </td>
              <td className="py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full"
                      style={{ width: `${Math.min(row.rate, 100)}%` }}
                    />
                  </div>
                  <span className="text-gray-300 w-10 text-right">{row.rate.toFixed(0)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SignerParticipationTable;
