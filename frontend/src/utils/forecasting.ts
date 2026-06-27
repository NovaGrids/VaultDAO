export interface DataPoint {
  x: number;
  y: number;
}

export function linearRegression(points: DataPoint[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0 };

  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
  const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

export function forecastNext(
  n: number,
  slope: number,
  intercept: number,
  lastX: number
): DataPoint[] {
  const forecast: DataPoint[] = [];
  for (let i = 1; i <= n; i++) {
    const x = lastX + i;
    forecast.push({
      x,
      y: Math.max(0, slope * x + intercept)
    });
  }
  return forecast;
}

export function calculateStdError(points: DataPoint[], slope: number, intercept: number): number {
  if (points.length < 3) return 0;
  const sumSquaredResiduals = points.reduce((acc, p) => {
    const predicted = slope * p.x + intercept;
    return acc + Math.pow(p.y - predicted, 2);
  }, 0);
  return Math.sqrt(sumSquaredResiduals / (points.length - 2));
}
