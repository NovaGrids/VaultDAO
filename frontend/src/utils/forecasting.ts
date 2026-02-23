export interface ForecastPoint {
  date: string;
  actual?: number;
  predicted?: number;
  lower?: number;
  upper?: number;
}

export function calculateMovingAverage(data: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    result.push(avg);
  }
  return result;
}

export function linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}

export function forecastSpending(
  historicalData: { date: string; amount: number }[],
  days: number
): ForecastPoint[] {
  if (historicalData.length < 2) return [];
  
  const x = historicalData.map((_, i) => i);
  const y = historicalData.map(d => d.amount);
  const { slope, intercept } = linearRegression(x, y);
  
  const stdDev = Math.sqrt(
    y.reduce((sum, yi, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0) / y.length
  );
  
  const result: ForecastPoint[] = historicalData.map((d, i) => ({
    date: d.date,
    actual: d.amount,
    predicted: slope * i + intercept
  }));
  
  const lastIndex = historicalData.length - 1;
  const lastDate = new Date(historicalData[lastIndex].date);
  
  for (let i = 1; i <= days; i++) {
    const futureDate = new Date(lastDate);
    futureDate.setDate(futureDate.getDate() + i);
    const predicted = slope * (lastIndex + i) + intercept;
    
    result.push({
      date: futureDate.toISOString().slice(0, 10),
      predicted: Math.max(0, predicted),
      lower: Math.max(0, predicted - 1.96 * stdDev),
      upper: predicted + 1.96 * stdDev
    });
  }
  
  return result;
}

export function calculateBurnRate(spending: number[], days: number): number {
  if (spending.length === 0) return 0;
  const total = spending.reduce((a, b) => a + b, 0);
  return total / days;
}

export function calculateRunway(balance: number, burnRate: number): number {
  if (burnRate <= 0) return Infinity;
  return balance / burnRate;
}
