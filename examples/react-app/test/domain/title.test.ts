import { describe, expect, it } from 'vitest';
import { normalizeTitle } from '@/domain/title';

describe('normalizeTitle', () => {
  it('removes surrounding spaces', () => {
    expect(normalizeTitle('  write tests ')).toBe('write tests');
  });

  it('cuts a long title to 80 characters', () => {
    expect(normalizeTitle('a'.repeat(100))).toHaveLength(80);
  });
});
