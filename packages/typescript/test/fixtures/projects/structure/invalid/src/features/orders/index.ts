import { cartTotal } from '../cart/internal/total.ts';

export function orderTotal(prices: readonly number[]): number {
  return cartTotal(prices);
}
