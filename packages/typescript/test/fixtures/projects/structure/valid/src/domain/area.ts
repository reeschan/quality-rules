import type { Shape } from './shape.ts';

export interface Area {
  readonly of: Shape | undefined;
  readonly value: number;
}
