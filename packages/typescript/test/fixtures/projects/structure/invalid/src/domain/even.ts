import { isOdd } from './odd.ts';

export function isEven(value: number): boolean {
  return value === 0 || isOdd(value - 1);
}
