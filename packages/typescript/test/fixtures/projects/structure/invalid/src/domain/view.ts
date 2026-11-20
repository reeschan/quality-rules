import { createElement } from 'react';

export function amountView(amount: number): unknown {
  return createElement('span', null, String(amount));
}
