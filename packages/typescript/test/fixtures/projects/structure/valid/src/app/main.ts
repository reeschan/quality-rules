import { cartTotal } from '../features/cart/index.ts';
import { orderLabel } from '../features/orders/index.ts';

export function start(prices: readonly number[]): string {
  return orderLabel(cartTotal(prices));
}
