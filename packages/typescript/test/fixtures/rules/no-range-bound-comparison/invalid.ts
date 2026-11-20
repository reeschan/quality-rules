interface Range {
  min: number;
  max: number;
}
declare const a: Range;
declare const b: Range;

export const overlaps = a.min <= b.max && b.min <= a.max;
export const before = a.max < b.min;
export const after = b.min > a.max;
export const chained = a?.min < b?.max;
export const bracket = a['min'] < b['max'];
