import { type FixtureRunResult, type LintFinding, lintFixtures } from 'lint-fixture-runner';
import { beforeAll, describe, expect, it } from 'vitest';
import plugin, { pluginName, rules } from '../../src/plugin.ts';

const ruleId = 'quality-rules/no-disable-comments';

function expectedFinding(line: number, column: number, directive: string): Partial<LintFinding> {
  return {
    file: 'invalid.ts',
    line,
    column,
    ruleId,
    message: `Lint suppression comment '${directive}' is not allowed. Configure the exception in the lint configuration with a reason instead.`,
  };
}

function findingsIn(findings: readonly LintFinding[], file: string): LintFinding[] {
  return findings.filter((finding) => finding.file === file);
}

describe(ruleId, () => {
  let result: FixtureRunResult;

  beforeAll(async () => {
    result = await lintFixtures({
      rulesModule: new URL('../../src/plugin.ts', import.meta.url),
      pluginName,
      fixturesDir: new URL('../fixtures/rules/no-disable-comments/', import.meta.url),
    });
  });

  it('is exported by the plugin under the quality-rules prefix', () => {
    expect(plugin.meta.name).toBe('quality-rules');
    expect(Object.keys(rules)).toContain('no-disable-comments');
  });

  it.each(['oxlint', 'eslint'] as const)(
    'reports eslint, oxlint and biome suppression comments on %s',
    (linter) => {
      expect(findingsIn(result[linter], 'invalid.ts')).toEqual(
        [
          expectedFinding(5, 3, 'eslint-disable-next-line'),
          expectedFinding(7, 27, 'eslint-disable-line'),
          expectedFinding(10, 1, 'eslint-disable'),
          expectedFinding(13, 1, 'eslint-disable-next-line'),
          expectedFinding(16, 1, 'oxlint-disable-next-line'),
          expectedFinding(19, 28, 'oxlint-disable-line'),
          expectedFinding(21, 1, 'oxlint-disable'),
          expectedFinding(24, 1, 'biome-ignore'),
          expectedFinding(27, 1, 'biome-ignore-all'),
          expectedFinding(29, 1, 'biome-ignore-start'),
          expectedFinding(33, 1, 'eslint-disable'),
        ].map((finding) => expect.objectContaining(finding))
      );
    }
  );

  it.each(['oxlint', 'eslint'] as const)('does not report ordinary comments on %s', (linter) => {
    expect(findingsIn(result[linter], 'valid.ts')).toEqual([]);
  });

  it('reports the same positions and messages on oxlint and ESLint', () => {
    expect(result.oxlint).toEqual(result.eslint);
  });
});
