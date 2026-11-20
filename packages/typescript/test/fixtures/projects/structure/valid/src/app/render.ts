import { createElement } from 'react';

export function renderLabel(label: string): unknown {
  return createElement('span', null, label);
}
