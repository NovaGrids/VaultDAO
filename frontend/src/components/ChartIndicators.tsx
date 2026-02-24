/**
 * Technical indicator calculations: MA, EMA, RSI, MACD.
 * Used by AdvancedChart for overlay series.
 */

export interface DataPoint {
  time: string;
  value: number;
  [key: string]: string | number;
}

/**
 * Simple Moving Average
 */
export function computeMA(data: DataPoint[], period: number, valueKey = 'value'): DataPoint[] {
  if (!data.length || period < 1) return [];
  const result: DataPoint[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ ...data[i], ma: NaN });
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += Number(data[j][valueKey]) || 0;
    }
    result.push({ ...data[i], ma: sum / period });
  }
  return result;
}

/**
 * Exponential Moving Average
 */
export function computeEMA(data: DataPoint[], period: number, valueKey = 'value'): DataPoint[] {
  if (!data.length || period < 1) return [];
  const k = 2 / (period + 1);
  const result: DataPoint[] = [];
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    const val = Number(data[i][valueKey]) || 0;
    if (ema === null) {
      ema = val;
    } else {
      ema = val * k + ema * (1 - k);
    }
    result.push({ ...data[i], ema });
  }
  return result;
}

/**
 * Relative Strength Index
 */
export function computeRSI(data: DataPoint[], period = 14, valueKey = 'value'): DataPoint[] {
  if (!data.length || period < 1) return [];
  const result: DataPoint[] = [];
  result.push({ ...data[0], rsi: 50 });
  for (let i = 1; i < data.length; i++) {
    let gains = 0;
    let losses = 0;
    const start = Math.max(0, i - period);
    for (let j = start + 1; j <= i; j++) {
      const prev = Number(data[j - 1][valueKey]) || 0;
      const curr = Number(data[j][valueKey]) || 0;
      const change = curr - prev;
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / (i - start);
    const avgLoss = losses / (i - start);
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    result.push({ ...data[i], rsi: Math.min(100, Math.max(0, rsi)) });
  }
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function computeMACD(
  data: DataPoint[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
  valueKey = 'value'
): DataPoint[] {
  if (!data.length || fastPeriod < 1 || slowPeriod < 1) return [];
  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);
  const signalK = 2 / (signalPeriod + 1);
  let fastEma: number | null = null;
  let slowEma: number | null = null;
  const macdLine: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const val = Number(data[i][valueKey]) || 0;
    fastEma = fastEma === null ? val : val * fastK + fastEma * (1 - fastK);
    slowEma = slowEma === null ? val : val * slowK + slowEma * (1 - slowK);
    macdLine.push(fastEma - slowEma);
  }
  let signalEma: number | null = null;
  const result: DataPoint[] = [];
  for (let i = 0; i < data.length; i++) {
    const macd = macdLine[i];
    signalEma = signalEma === null ? macd : macd * signalK + signalEma * (1 - signalK);
    const histogram = macd - signalEma;
    result.push({
      ...data[i],
      macd: Math.round(macd * 1e6) / 1e6,
      macdSignal: Math.round(signalEma * 1e6) / 1e6,
      macdHistogram: Math.round(histogram * 1e6) / 1e6,
    });
  }
  return result;
}
