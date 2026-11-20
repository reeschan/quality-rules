import type { Area } from './area.ts';

export interface Shape {
  readonly kind: string;
  readonly area: Area;
}
