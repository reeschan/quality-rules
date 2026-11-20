import { cartTotal } from '../features/cart/internal/total.ts';

export function start(prices: readonly number[]): number {
  return cartTotal(prices);
}
