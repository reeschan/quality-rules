import { sum } from '../../../domain/sum.ts';

export function cartTotal(prices: readonly number[]): number {
  return sum(prices);
}
