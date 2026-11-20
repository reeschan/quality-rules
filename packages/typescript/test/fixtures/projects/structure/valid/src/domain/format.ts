import type { Shape } from './shape.ts';
import { sum } from './sum.ts';

export function formatAmount(amount: number): string {
  return sum([amount]).toFixed(2);
}

export function describeShape(shape: Shape): string {
  return shape.kind;
}
