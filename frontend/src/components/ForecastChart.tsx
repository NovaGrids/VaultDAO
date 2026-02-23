import React from 'react';
import { TrendingUp } from 'lucide-react';
import type { ForecastPoint } from '../utils/forecasting';

interface ForecastChartProps {
  data: ForecastPoint[];
  height?: number;
  title?: string;
}

const ForecastChart: React.FC<ForecastChartProps> = ({ data, height = 300, title }) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-gray-500 text-sm">No forecast data available</p>
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map(d => Math.max(d.actual || 0, d.predicted || 0, d.upper || 0))
  );
  const minValue = Math.min(...data.map(d => d.lower || d.actual || d.predicted || 0));
  const range = maxValue - minValue || 1;

  const getY = (value: number) => {
    return height - 40 - ((value - minValue) / range) * (height - 80);
  };

  const actualPoints = data.filter(d => d.actual !== undefined);
  const predictedPoints = data.filter(d => d.predicted !== undefined);

  return (
    <div>
      {title && (
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-purple-400" />
          <h4 className="font-semibold text-white">{title}</h4>
        </div>
      )}
      <svg width="100%" height={height} className="overflow-visible">
        <defs>
          <linearGradient id="confidenceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Confidence interval */}
        {predictedPoints.length > 0 && predictedPoints[0].lower !== undefined && (
          <path
            d={predictedPoints
              .map((d) => {
                const idx = data.indexOf(d);
                const x = (idx / (data.length - 1)) * 100;
                const yUpper = getY(d.upper || 0);
                const yLower = getY(d.lower || 0);
                return idx === 0
                  ? `M ${x}% ${yUpper} L ${x}% ${yLower}`
                  : `L ${x}% ${yUpper} M ${x}% ${yLower}`;
              })
              .join(' ')}
            fill="url(#confidenceGradient)"
            stroke="none"
          />
        )}

        {/* Actual line */}
        {actualPoints.length > 1 && (
          <polyline
            points={actualPoints
              .map((d) => {
                const idx = data.indexOf(d);
                const x = (idx / (data.length - 1)) * 100;
                const y = getY(d.actual || 0);
                return `${x}%,${y}`;
              })
              .join(' ')}
            fill="none"
            stroke="#22c55e"
            strokeWidth="2"
          />
        )}

        {/* Predicted line */}
        {predictedPoints.length > 1 && (
          <polyline
            points={predictedPoints
              .map((d) => {
                const idx = data.indexOf(d);
                const x = (idx / (data.length - 1)) * 100;
                const y = getY(d.predicted || 0);
                return `${x}%,${y}`;
              })
              .join(' ')}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            strokeDasharray="5,5"
          />
        )}

        {/* Y-axis labels */}
        <text x="5" y="30" fill="#9ca3af" fontSize="12">
          {maxValue.toFixed(0)}
        </text>
        <text x="5" y={height - 20} fill="#9ca3af" fontSize="12">
          {minValue.toFixed(0)}
        </text>
      </svg>

      <div className="flex items-center justify-center gap-6 mt-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-green-500" />
          <span className="text-gray-400">Actual</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-purple-500 border-dashed" style={{ borderTop: '2px dashed' }} />
          <span className="text-gray-400">Forecast</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-purple-500 opacity-20" />
          <span className="text-gray-400">Confidence</span>
        </div>
      </div>
    </div>
  );
};

export default ForecastChart;
