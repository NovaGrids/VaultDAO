/**
 * Advanced chart with multiple types, technical indicators, drawing tools, and export.
 * Mobile responsive with touch gestures.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Area,
  Bar,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Brush,
} from 'recharts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Image, FileText, Save } from 'lucide-react';
import { computeMA, computeEMA, computeRSI, computeMACD, type DataPoint } from './ChartIndicators';
import ChartTools, { type Drawing, type DrawingTool } from './ChartTools';

const CHART_CONFIG_KEY = 'vaultdao_advanced_chart_config';

export type ChartType = 'line' | 'area' | 'bar';

export interface ChartSeries {
  dataKey: string;
  name: string;
  color?: string;
}

export interface AdvancedChartConfig {
  chartType: ChartType;
  indicators: { ma?: number; ema?: number; rsi?: boolean; macd?: boolean };
  drawings: Drawing[];
}

export interface AdvancedChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: ChartSeries[];
  title?: string;
  height?: number;
  valueKey?: string;
  configKey?: string;
  className?: string;
}

const DEFAULT_CONFIG: AdvancedChartConfig = {
  chartType: 'line',
  indicators: {},
  drawings: [],
};

function loadConfig(key: string): AdvancedChartConfig {
  try {
    const raw = localStorage.getItem(`${CHART_CONFIG_KEY}_${key}`);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AdvancedChartConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(key: string, config: AdvancedChartConfig): void {
  try {
    localStorage.setItem(`${CHART_CONFIG_KEY}_${key}`, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function AdvancedChart({
  data,
  xKey,
  series,
  title,
  height = 360,
  valueKey = 'value',
  configKey = 'default',
  className = '',
}: AdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<AdvancedChartConfig>(() => loadConfig(configKey));
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');

  useEffect(() => {
    saveConfig(configKey, config);
  }, [config, configKey]);

  const primaryKey = series[0]?.dataKey ?? valueKey;
  const dataWithTime: DataPoint[] = data.map((d) => ({
    ...d,
    time: String(d[xKey] ?? ''),
    value: Number(d[primaryKey]) || 0,
  })) as DataPoint[];

  const maData = config.indicators.ma
    ? computeMA(dataWithTime, config.indicators.ma, primaryKey)
    : dataWithTime;
  const emaData = config.indicators.ema
    ? computeEMA(config.indicators.ma ? maData : dataWithTime, config.indicators.ema, primaryKey)
    : config.indicators.ma ? maData : dataWithTime;
  const rsiData = config.indicators.rsi
    ? computeRSI(dataWithTime, 14, primaryKey)
    : emaData;
  const macdData = config.indicators.macd
    ? computeMACD(dataWithTime, 12, 26, 9, primaryKey)
    : rsiData;

  const chartData = macdData;

  const handleExportImage = useCallback(() => {
    if (!containerRef.current) return;
    html2canvas(containerRef.current, { useCORS: true, scale: 2 }).then((canvas) => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `chart-${configKey}-${Date.now()}.png`;
      a.click();
    });
  }, [configKey]);

  const handleExportPDF = useCallback(() => {
    if (!containerRef.current) return;
    html2canvas(containerRef.current, { useCORS: true, scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm' });
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, w, Math.min(h, 200));
      pdf.save(`chart-${configKey}-${Date.now()}.pdf`);
    });
  }, [configKey]);

  const handleSaveConfig = useCallback(() => {
    setConfig((prev) => ({ ...prev, drawings: config.drawings }));
    saveConfig(configKey, { ...config, drawings: config.drawings });
  }, [config, configKey]);

  const handleToolChange = useCallback((tool: DrawingTool) => {
    setActiveTool(tool);
  }, []);

  const handleDrawingsChange = useCallback((drawings: Drawing[]) => {
    setConfig((prev) => ({ ...prev, drawings }));
  }, []);

  const toggleIndicator = useCallback((key: keyof AdvancedChartConfig['indicators'], value?: number) => {
    setConfig((prev) => {
      const next = { ...prev, indicators: { ...prev.indicators } };
      if (key === 'rsi' || key === 'macd') {
        (next.indicators as Record<string, boolean>)[key] = value !== undefined ? Boolean(value) : !(prev.indicators as Record<string, boolean>)[key];
      } else {
        (next.indicators as Record<string, number | undefined>)[key] = value ?? undefined;
      }
      return next;
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-800/80 p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={config.chartType}
            onChange={(e) => setConfig((p) => ({ ...p, chartType: e.target.value as ChartType }))}
            className="rounded-lg border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-white"
          >
            <option value="line">Line</option>
            <option value="area">Area</option>
            <option value="bar">Bar</option>
          </select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleIndicator('ma', config.indicators.ma ? undefined : 7)}
              className={`rounded px-2 py-1 text-xs ${config.indicators.ma ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              MA
            </button>
            <button
              type="button"
              onClick={() => toggleIndicator('ema', config.indicators.ema ? undefined : 12)}
              className={`rounded px-2 py-1 text-xs ${config.indicators.ema ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              EMA
            </button>
            <button
              type="button"
              onClick={() => toggleIndicator('rsi')}
              className={`rounded px-2 py-1 text-xs ${config.indicators.rsi ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              RSI
            </button>
            <button
              type="button"
              onClick={() => toggleIndicator('macd')}
              className={`rounded px-2 py-1 text-xs ${config.indicators.macd ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              MACD
            </button>
          </div>
          <ChartTools
            activeTool={activeTool}
            onToolChange={handleToolChange}
            drawings={config.drawings}
            onDrawingsChange={handleDrawingsChange}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExportImage}
              className="flex items-center gap-1 rounded-lg bg-gray-700 px-2 py-1.5 text-sm text-white hover:bg-gray-600"
              title="Export PNG"
            >
              <Image className="h-4 w-4" />
              PNG
            </button>
            <button
              type="button"
              onClick={handleExportPDF}
              className="flex items-center gap-1 rounded-lg bg-gray-700 px-2 py-1.5 text-sm text-white hover:bg-gray-600"
              title="Export PDF"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              className="flex items-center gap-1 rounded-lg bg-purple-600 px-2 py-1.5 text-sm text-white hover:bg-purple-700"
              title="Save configuration"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 touch-pan-x touch-pan-y" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            syncId="advanced-chart"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey={xKey}
              stroke="#9ca3af"
              tick={{ fill: '#9ca3af', fontSize: 11 }}
              tickFormatter={(v: unknown) =>
                v && String(v).length > 10 ? String(v).slice(0, 7) : String(v ?? '')
              }
            />
            <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value: number | undefined) => [value ?? 0, undefined]}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(v) => <span className="text-gray-400">{v}</span>}
            />
            <Brush dataKey={xKey} height={24} stroke="#4b5563" fill="#1f2937" />
            {series.map((s) =>
              config.chartType === 'area' ? (
                <Area
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={s.color ?? '#818cf8'}
                  fill={s.color ?? '#818cf8'}
                  fillOpacity={0.3}
                  strokeWidth={2}
                  connectNulls
                />
              ) : config.chartType === 'bar' ? (
                <Bar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  name={s.name}
                  fill={s.color ?? '#818cf8'}
                  radius={[4, 4, 0, 0]}
                />
              ) : (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={s.color ?? '#818cf8'}
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#1f2937' }}
                  connectNulls
                />
              )
            )}
            {config.indicators.ma && (
              <Line
                type="monotone"
                dataKey="ma"
                name={`MA(${config.indicators.ma})`}
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            )}
            {config.indicators.ema && (
              <Line
                type="monotone"
                dataKey="ema"
                name={`EMA(${config.indicators.ema})`}
                stroke="#10b981"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {config.indicators.rsi && (
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey={xKey} hide />
              <YAxis domain={[0, 100]} stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 10 }} width={28} />
              <Line
                type="monotone"
                dataKey="rsi"
                name="RSI"
                stroke="#ec4899"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="2 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {config.indicators.macd && (
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey={xKey} hide />
              <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 10 }} width={36} />
              <Line
                type="monotone"
                dataKey="macd"
                name="MACD"
                stroke="#8b5cf6"
                strokeWidth={1}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="macdSignal"
                name="Signal"
                stroke="#06b6d4"
                strokeWidth={1}
                dot={false}
                connectNulls
              />
              <Bar dataKey="macdHistogram" fill="#6366f1" fillOpacity={0.5} radius={[2, 2, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default AdvancedChart;
