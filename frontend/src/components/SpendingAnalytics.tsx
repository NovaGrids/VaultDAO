import React, { useState } from 'react';
import SpendingAreaChart from './charts/SpendingAreaChart';

export function SpendingAnalytics() {
  const [data] = useState([
    { date: 'Mon', amount: 100 },
    { date: 'Tue', amount: 250 },
    { date: 'Wed', amount: 450 },
    { date: 'Thu', amount: 600 },
  ]);
  const limit = 1000;

  return (
    <div className="bg-gray-800/50 p-6 rounded-xl border border-gray-700">
      <h2 className="text-xl font-bold text-white mb-4">Spending Analytics & Burn Rate</h2>
      <SpendingAreaChart data={data} limit={limit} />
      <div className="mt-4 flex gap-4 text-sm">
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500"></span> {'< 50% Limit'}</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500"></span> {'50-80% Limit'}</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500"></span> {'> 80% Limit'}</div>
      </div>
    </div>
  );
}

export default SpendingAnalytics;
