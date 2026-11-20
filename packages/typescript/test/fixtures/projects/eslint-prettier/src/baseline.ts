export function loose(value: any, limit: number): boolean {
  limit = limit + 1;
  return value == limit;
}
