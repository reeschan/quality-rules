import { type FixtureRunResult, type LintFinding, lintFixtures } from 'lint-fixture-runner';
import { beforeAll, describe, expect, it } from 'vitest';
import { rules } from '../../src/rules/index.ts';

const ruleId = 'quality-rules/no-props-destructuring';

function expectedFinding(line: number, column: number, name: string): Partial<LintFinding> {
  return {
    file: 'invalid.tsx',
    line,
    column,
    ruleId,
    message: `Do not destructure props in the parameter list of component '${name}'. Take 'props' and read 'props.xxx' instead.`,
  };
}

function findingsIn(findings: readonly LintFinding[], file: string): LintFinding[] {
  return findings.filter((finding) => finding.file === file);
}

describe(ruleId, () => {
  let result: FixtureRunResult;

  beforeAll(async () => {
    result = await lintFixtures({
      rulesModule: new URL('../../src/rules/index.ts', import.meta.url),
      pluginName: 'quality-rules',
      fixturesDir: new URL('../fixtures/rules/no-props-destructuring/', import.meta.url),
    });
  });

  it('is exported in the rules table', () => {
    expect(Object.keys(rules)).toContain('no-props-destructuring');
  });

  it.each(['oxlint', 'eslint'] as const)(
    'reports destructured props of components on %s',
    (linter) => {
      expect(findingsIn(result[linter], 'invalid.tsx')).toEqual(
        [
          expectedFinding(4, 26, 'Greeting'),
          expectedFinding(8, 23, 'Badge'),
          expectedFinding(12, 32, 'Title'),
          expectedFinding(16, 27, 'Card'),
          expectedFinding(18, 68, 'Field'),
          expectedFinding(22, 44, 'Row'),
          expectedFinding(26, 27, 'Defaulted'),
        ].map((finding) => expect.objectContaining(finding))
      );
    }
  );

  it.each(['oxlint', 'eslint'] as const)(
    'does not report props objects, other functions or other destructuring on %s',
    (linter) => {
      expect(findingsIn(result[linter], 'valid.tsx')).toEqual([]);
    }
  );

  it('reports the same positions and messages on oxlint and ESLint', () => {
    expect(result.oxlint).toEqual(result.eslint);
  });
});
