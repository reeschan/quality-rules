interface Range {
  min: number;
  max: number;
}
declare const a: Range;
declare const b: Range;

export const overlaps = a.min <= b.max;
