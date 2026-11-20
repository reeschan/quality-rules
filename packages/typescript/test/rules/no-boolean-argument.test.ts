import { type FixtureRunResult, type LintFinding, lintFixtures } from 'lint-fixture-runner';
import { beforeAll, describe, expect, it } from 'vitest';
import plugin, { pluginName, rules } from '../../src/plugin.ts';

const ruleName = 'no-boolean-argument';
const ruleId = `${pluginName}/${ruleName}`;

function expectedFinding(
  file: string,
  line: number,
  column: number,
  value: 'true' | 'false'
): Partial<LintFinding> {
  return {
    file,
    line,
    column,
    ruleId,
    message: `Boolean literal '${value}' is not allowed as an argument. Use separate functions with descriptive names instead.`,
  };
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
    withOptions = await run({
      [ruleName]: [{ allowFunctions: ['toggle'], allowNamePatterns: ['^set[A-Z]'] }],
    });
  });

  it('is exported by the plugin under the quality-rules prefix', () => {
    expect(plugin.meta.name).toBe('quality-rules');
    expect(Object.keys(rules)).toContain(ruleName);
  });

  it.each(['oxlint', 'eslint'] as const)('reports boolean literal arguments on %s', (linter) => {
    expect(findingsOf(withoutOptions[linter], 'invalid.ts')).toEqual(
      [
        expectedFinding('invalid.ts', 7, 17, 'true'),
        expectedFinding('invalid.ts', 8, 12, 'false'),
        expectedFinding('invalid.ts', 9, 12, 'true'),
        expectedFinding('invalid.ts', 10, 13, 'true'),
        expectedFinding('invalid.ts', 11, 15, 'false'),
        expectedFinding('invalid.ts', 11, 23, 'false'),
      ].map((finding) => expect.objectContaining(finding))
    );
  });

  it.each(['oxlint', 'eslint'] as const)(
    'reports every call when no function is allowed on %s',
    (linter) => {
      expect(findingsOf(withoutOptions[linter], 'allowed-by-options.ts')).toEqual(
        [
          expectedFinding('allowed-by-options.ts', 5, 8, 'true'),
          expectedFinding('allowed-by-options.ts', 6, 12, 'false'),
          expectedFinding('allowed-by-options.ts', 7, 18, 'true'),
          expectedFinding('allowed-by-options.ts', 8, 11, 'false'),
        ].map((finding) => expect.objectContaining(finding))
      );
    }
  );

  it.each(['oxlint', 'eslint'] as const)(
    'skips allowed function names and name patterns on %s',
    (linter) => {
      expect(findingsOf(withOptions[linter], 'allowed-by-options.ts')).toEqual([
        expect.objectContaining(expectedFinding('allowed-by-options.ts', 8, 11, 'false')),
      ]);
      expect(findingsOf(withOptions[linter], 'invalid.ts')).toHaveLength(6);
    }
  );

  it.each(['oxlint', 'eslint'] as const)('does not report valid code on %s', (linter) => {
    expect(findingsOf(withoutOptions[linter], 'valid.ts')).toEqual([]);
    expect(findingsOf(withOptions[linter], 'valid.ts')).toEqual([]);
  });

  it('reports the same positions and messages on oxlint and ESLint', () => {
    expect(withoutOptions.oxlint).toEqual(withoutOptions.eslint);
    expect(withOptions.oxlint).toEqual(withOptions.eslint);
  });
});
