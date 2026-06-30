import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export interface SpendingData {
  date: string;
  amount: number;
}

interface Props {
  data: SpendingData[];
  limit?: number;
  height?: number;
}

export const SpendingAreaChart: React.FC<Props> = ({ data, limit, height = 256 }) => {
  // Simple forecast extension logic
  const extendedData = [...data];
  if (data.length >= 2 && limit) {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const diff = last.amount - prev.amount;
    if (diff > 0) {
      let currentAmount = last.amount;
      let i = 1;
      while (currentAmount < limit && i <= 7) {
        currentAmount += diff;
        extendedData.push({ date: `Forecast +${i}`, amount: currentAmount });
        i++;
      }
    }
  }

  return (
    <div className="w-full transition-all duration-500 ease-in-out" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={extendedData}>
          <XAxis dataKey="date" stroke="#6b7280" />
          <YAxis stroke="#6b7280" />
          <Tooltip 
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const val = payload[0].value as number;
              let warning = "";
              if (limit) {
                const perc = val / limit;
                if (perc > 0.8) warning = " (Critical: >80% limit)";
                else if (perc > 0.5) warning = " (Warning: >50% limit)";
              }
              return (
                <div className="bg-gray-800 p-2 border border-gray-700 rounded shadow">
                  <p className="text-white">${val.toFixed(2)}{warning}</p>
                </div>
              );
            }} 
          />
          <Area 
            type="monotone" 
            dataKey="amount" 
            stroke="#8b5cf6" 
            fill="#8b5cf6" 
            fillOpacity={0.3} 
          />
          {limit && (
            <ReferenceLine y={limit} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'Limit', fill: '#ef4444' }} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SpendingAreaChart;
