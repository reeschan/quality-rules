interface Range {
  min: number;
  max: number;
}

export function overlaps(a: Range, b: Range): boolean {
  return a.min <= b.max && b.min <= a.max;
}
