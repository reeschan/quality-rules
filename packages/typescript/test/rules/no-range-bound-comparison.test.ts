import { type FixtureRunResult, type LintFinding, lintFixtures } from 'lint-fixture-runner';
import { beforeAll, describe, expect, it } from 'vitest';
import plugin, { pluginName, rules } from '../../src/plugin.ts';

const ruleName = 'no-range-bound-comparison';
const ruleId = `${pluginName}/${ruleName}`;
const message =
  'Comparing range bounds by hand is not allowed here. Use a shared range function instead.';

function expectedFinding(file: string, line: number, column: number): Partial<LintFinding> {
  return { file, line, column, ruleId, message };
}

function findingsOf(findings: readonly LintFinding[], file: string): LintFinding[] {
  return findings.filter((finding) => finding.ruleId === ruleId && finding.file === file);
}

function run(
  ruleOptions?: Readonly<Record<string, readonly unknown[]>>
): Promise<FixtureRunResult> {
  return lintFixtures({
    rulesModule: new URL('../../src/plugin.ts', import.meta.url),
    pluginName,
    fixturesDir: new URL(`../fixtures/rules/${ruleName}/`, import.meta.url),
    ...(ruleOptions === undefined ? {} : { ruleOptions }),
  });
}

describe(ruleId, () => {
  let withoutOptions: FixtureRunResult;
  let withOptions: FixtureRunResult;

  beforeAll(async () => {
    withoutOptions = await run();
    withOptions = await run({ [ruleName]: [{ allowFiles: ['allowed/**'] }] });
  });

  it('is exported by the plugin under the quality-rules prefix', () => {
    expect(plugin.meta.name).toBe('quality-rules');
    expect(Object.keys(rules)).toContain(ruleName);
  });

  it.each(['oxlint', 'eslint'] as const)(
    'reports comparisons of the min of one range with the max of another on %s',
    (linter) => {
      expect(findingsOf(withoutOptions[linter], 'invalid.ts')).toEqual(
        [
          expectedFinding('invalid.ts', 8, 25),
          expectedFinding('invalid.ts', 8, 43),
          expectedFinding('invalid.ts', 9, 23),
          expectedFinding('invalid.ts', 10, 22),
          expectedFinding('invalid.ts', 11, 24),
          expectedFinding('invalid.ts', 12, 24),
        ].map((finding) => expect.objectContaining(finding))
      );
    }
  );

  it.each(['oxlint', 'eslint'] as const)(
    'reports the allowed file when no file is allowed on %s',
    (linter) => {
      expect(findingsOf(withoutOptions[linter], 'allowed/overlap.ts')).toEqual([
        expect.objectContaining(expectedFinding('allowed/overlap.ts', 8, 25)),
      ]);
    }
  );

  it.each(['oxlint', 'eslint'] as const)('skips the allowed files on %s', (linter) => {
    expect(findingsOf(withOptions[linter], 'allowed/overlap.ts')).toEqual([]);
    expect(findingsOf(withOptions[linter], 'invalid.ts')).toHaveLength(6);
  });

  it.each(['oxlint', 'eslint'] as const)('does not report other comparisons on %s', (linter) => {
    expect(findingsOf(withoutOptions[linter], 'valid.ts')).toEqual([]);
    expect(findingsOf(withOptions[linter], 'valid.ts')).toEqual([]);
  });

  it('reports the same positions and messages on oxlint and ESLint', () => {
    expect(withoutOptions.oxlint).toEqual(withoutOptions.eslint);
    expect(withOptions.oxlint).toEqual(withOptions.eslint);
  });
});
