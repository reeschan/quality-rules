import { type FixtureRunResult, type LintFinding, lintFixtures } from 'lint-fixture-runner';
import { beforeAll, describe, expect, it } from 'vitest';
import plugin, { pluginName, rules } from '../../src/plugin.ts';

const ruleName = 'no-scientific-literal';
const ruleId = `${pluginName}/${ruleName}`;

function expectedFinding(
  file: string,
  line: number,
  column: number,
  raw: string
): Partial<LintFinding> {
  return {
    file,
    line,
    column,
    ruleId,
    message: `Scientific notation '${raw}' is not allowed here. Define the value in one of the allowed files and import it instead.`,
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
      [ruleName]: [{ allowFiles: ['constants/tolerance.ts', 'generated/**'] }],
    });
  });

  it('is exported by the plugin under the quality-rules prefix', () => {
    expect(plugin.meta.name).toBe('quality-rules');
    expect(Object.keys(rules)).toContain(ruleName);
  });

  it.each(['oxlint', 'eslint'] as const)('reports scientific notation on %s', (linter) => {
    expect(findingsOf(withoutOptions[linter], 'invalid.ts')).toEqual(
      [
        expectedFinding('invalid.ts', 1, 24, '1e-9'),
        expectedFinding('invalid.ts', 2, 20, '2.5E3'),
        expectedFinding('invalid.ts', 3, 22, '1_0e+2'),
        expectedFinding('invalid.ts', 4, 22, '.5e-3'),
        expectedFinding('invalid.ts', 5, 30, '1E5'),
      ].map((finding) => expect.objectContaining(finding))
    );
  });

  it.each(['oxlint', 'eslint'] as const)(
    'reports the allowed files too when no file is allowed on %s',
    (linter) => {
      expect(findingsOf(withoutOptions[linter], 'constants/tolerance.ts')).toHaveLength(1);
      expect(findingsOf(withoutOptions[linter], 'generated/table.ts')).toHaveLength(3);
    }
  );

  it.each(['oxlint', 'eslint'] as const)('skips the allowed files on %s', (linter) => {
    expect(findingsOf(withOptions[linter], 'constants/tolerance.ts')).toEqual([]);
    expect(findingsOf(withOptions[linter], 'generated/table.ts')).toEqual([]);
    expect(findingsOf(withOptions[linter], 'invalid.ts')).toHaveLength(5);
  });

  it.each(['oxlint', 'eslint'] as const)(
    'does not report numbers without an exponent on %s',
    (linter) => {
      expect(findingsOf(withoutOptions[linter], 'valid.ts')).toEqual([]);
      expect(findingsOf(withOptions[linter], 'valid.ts')).toEqual([]);
    }
  );

  it('reports the same positions and messages on oxlint and ESLint', () => {
    expect(withoutOptions.oxlint).toEqual(withoutOptions.eslint);
    expect(withOptions.oxlint).toEqual(withOptions.eslint);
  });
});
