import { byApp } from '../domain/by-app';
import { sum } from '../domain/sum';

export function main(values: number[]): string {
  return `${byApp()}${sum(values)}`;
}
