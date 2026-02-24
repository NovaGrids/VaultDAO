/**
 * Chart drawing tools: trendlines, rectangles, annotations.
 * Integrates with AdvancedChart for overlay rendering.
 */

import { useState, useCallback } from 'react';
import { TrendingUp, Square, Type, Trash2, ChevronDown } from 'lucide-react';

export type DrawingTool = 'none' | 'trendline' | 'rectangle' | 'annotation';

export interface Trendline {
  id: string;
  type: 'trendline';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
}

export interface Rectangle {
  id: string;
  type: 'rectangle';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
}

export interface Annotation {
  id: string;
  type: 'annotation';
  x: number;
  y: number;
  text: string;
  color?: string;
}

export type Drawing = Trendline | Rectangle | Annotation;

interface ChartToolsProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  drawings: Drawing[];
  onDrawingsChange: (drawings: Drawing[]) => void;
  disabled?: boolean;
  className?: string;
}

const TOOLS: { value: DrawingTool; label: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'Select', icon: null },
  { value: 'trendline', label: 'Trendline', icon: <TrendingUp className="h-4 w-4" /> },
  { value: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { value: 'annotation', label: 'Annotation', icon: <Type className="h-4 w-4" /> },
];

export function ChartTools({
  activeTool,
  onToolChange,
  drawings,
  onDrawingsChange,
  disabled = false,
  className = '',
}: ChartToolsProps) {
  const [showTools, setShowTools] = useState(false);

  const handleClearAll = useCallback(() => {
    onDrawingsChange([]);
    onToolChange('none');
  }, [onDrawingsChange, onToolChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onDrawingsChange(drawings.filter((d) => d.id !== id));
    },
    [drawings, onDrawingsChange]
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          disabled={disabled}
          className="flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          <span>Tools</span>
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
        {showTools && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowTools(false)}
              aria-hidden
            />
            <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
              <div className="flex flex-col gap-1">
                {TOOLS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      onToolChange(t.value);
                      setShowTools(false);
                    }}
                    className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${
                      activeTool === t.value ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {drawings.length > 0 && (
        <>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={disabled}
            className="flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Clear all
          </button>
          <div className="flex flex-wrap gap-1">
            {drawings.slice(-5).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => handleRemove(d.id)}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-600 hover:text-white"
              >
                {d.type} ×
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ChartTools;
