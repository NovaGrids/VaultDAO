/**
 * GovernanceHealthWidget
 *
 * Displays governance health metrics: participation rate (donut chart),
 * active proposals count, and compliance score (colored badge).
 * Auto-refreshes every 30 seconds via useGovernanceHealth.
 */
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useGovernanceHealth } from '../../hooks/useGovernanceHealth';

interface GovernanceHealthWidgetProps {
  title: string;
}

function complianceColor(score: number): string {
  if (score >= 80) return 'bg-green-500 text-white';
  if (score >= 50) return 'bg-yellow-500 text-white';
  return 'bg-red-500 text-white';
}

const GovernanceHealthWidget: React.FC<GovernanceHealthWidgetProps> = ({ title }) => {
  const { data, loading, error } = useGovernanceHealth();

  if (loading) {
    return (
      <div className="h-full flex flex-col gap-3 p-2" aria-busy="true" aria-label="Loading governance health">
        <div className="h-4 bg-gray-700 rounded animate-pulse w-1/2" />
        <div className="flex-1 bg-gray-700 rounded animate-pulse" />
        <div className="h-6 bg-gray-700 rounded animate-pulse w-1/3" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
        <p>{error ? `Error: ${error}` : 'No governance data available yet.'}</p>
      </div>
    );
  }

  const donutData = [
    { name: 'Participated', value: data.participationRate },
    { name: 'Absent', value: 100 - data.participationRate },
  ];

  return (
    <div className="h-full flex flex-col gap-2 p-2">
      <h3 className="text-sm font-semibold text-white">{title}</h3>

      {/* Donut chart — participation rate */}
      <div className="flex-1 min-h-0" role="img" aria-label={`Participation rate: ${data.participationRate}%`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={donutData}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              aria-label="Participation rate donut chart"
            >
              <Cell fill="#8B5CF6" />
              <Cell fill="#374151" />
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                `${typeof value === 'number' ? value : Number(value ?? 0)}%`,
                String(name),
              ]}
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Centre label overlaid — participation % */}
      <p className="text-center text-lg font-bold text-white -mt-10">
        {data.participationRate}%
        <span className="block text-xs font-normal text-gray-400">Participation</span>
      </p>

      {/* Stats row */}
      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="text-center">
          <p className="text-xl font-bold text-white">{data.activeProposals}</p>
          <p className="text-xs text-gray-400">Active Proposals</p>
        </div>
        <div className="text-center">
          <span
            className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${complianceColor(data.complianceScore)}`}
            aria-label={`Compliance score: ${data.complianceScore}`}
          >
            {data.complianceScore}% Compliant
          </span>
        </div>
      </div>
    </div>
  );
};

export default GovernanceHealthWidget;
