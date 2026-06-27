/** Normalize Express route params that may be string or string[]. */
export function routeParam(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}
