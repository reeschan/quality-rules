interface Range {
  min: number;
  max: number;
}
declare const a: Range;
declare const b: Range;

export const wellFormed = a.min <= a.max;
export const sameBound = a.min < b.min;
export const otherBound = a.max > b.max;
export const unrelated = a.min < 10 && b.max > 3;
export const equal = a.min === b.max;
export const lengths = a.max - a.min < b.max - b.min;
export const clamped = Math.max(a.min, b.min) <= Math.min(a.max, b.max);
