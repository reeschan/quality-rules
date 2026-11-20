import { taxRate } from '../app/settings.ts';

export function withTax(amount: number): number {
  return amount * (1 + taxRate);
}
