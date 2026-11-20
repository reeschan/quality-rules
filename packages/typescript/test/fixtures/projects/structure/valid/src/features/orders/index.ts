import { formatAmount } from '../../domain/format.ts';
import { cartTotal } from '../cart/index.ts';

export function orderLabel(total: number): string {
  return formatAmount(total + cartTotal([]));
}
