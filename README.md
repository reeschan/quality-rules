# quality-rules

Selectable code rules, packaged per language and framework. A project picks the packs (bundles of lint rules and written conventions) it wants, records the choice in one manifest, and a CLI generates the configuration of each tool from it.

- Lint presets for biome, oxlint, knip and dependency-cruiser (or ESLint and Prettier instead of biome and oxlint).
- Custom lint rules under the `quality-rules/` prefix that run on oxlint and on ESLint.
- Conventions: short documents (reason, bad and good example, questions to check) that people and review agents read.
- Checks for duplication in changed lines and for folders that unit tests must import.

The guides are written in Japanese: [manifest guide](docs/guides/manifest.md), [adding a layer for another language](docs/guides/adding-a-layer.md).

## Packages

| Package | Contents |
| --- | --- |
| `@reeschan/quality-rules-typescript` | TypeScript packs, custom rules, conventions, and the `quality-rules` CLI |
| `@reeschan/quality-rules-react` | React packs (a11y and JSX rules, `no-props-destructuring`) |

The shared conventions are bundled into the language package. The workspace package `packages/rules` is not published on its own.

## Install

Node.js 22.18 or later.

```sh
pnpm add -D @reeschan/quality-rules-typescript @reeschan/quality-rules-react
```

The React package is optional. Install the tools whose configuration you use (biome, oxlint, knip, dependency-cruiser, or ESLint and Prettier).

## Manifest

Create `quality-rules.json` in the project root:

```json
{
  "packs": ["baseline", "size-limits", "lint-hygiene", "naming", "unused-code"],
  "exclude": ["quality-rules/no-boolean-argument"],
  "include": [],
  "options": { "max-params": 5 },
  "toolchain": "biome-oxlint"
}
```

Do not write `"packages"` or `"resolved"` yourself: `sync` writes `packages` (the versions it synced) and `resolved` (the rules and conventions in effect). `quality-rules list` shows the available packs. Every field is described in the [manifest guide](docs/guides/manifest.md).

## Commands

```sh
npx quality-rules list           # packs, rules and conventions (add --json for JSON)
npx quality-rules sync           # write the generated files into quality-rules/
npx quality-rules sync --accept NAME-3     # take in one pending rule or convention (repeatable)
npx quality-rules sync --accept-all        # take in every pending one
npx quality-rules check          # CI: fail when the generated files differ from what sync writes
npx quality-rules duplication    # duplication in lines changed against the base branch
npx quality-rules unit-tests     # every file in the chosen folders is imported by a unit test
```

All commands accept `--cwd <folder>` (the project folder) and `--help`.

`check` only compares the generated files and the manifest with what `sync` would write. It does not run `duplication` or `unit-tests`; run those as their own steps. Pending rules are listed by `sync` and `check`, but they stay off until accepted and do not fail `check`.

Exit codes: 0 passes, 1 a check failed, 2 a broken manifest, catalog or command line.

## Using the generated files

`sync` writes into `quality-rules/`. It never edits your own configuration files; the first time it prints the line to add. Do not edit the generated files by hand: `check` fails if you do.

biome (`biome.json`):

```json
{ "extends": ["./quality-rules/biome.json"] }
```

oxlint (`.oxlintrc.json`; the custom rules load from `quality-rules/oxlint-plugin.mjs` through it):

```json
{ "extends": ["./quality-rules/oxlint.json"] }
```

knip (`knip.config.js`): import the preset, then add `entry`, `ignore` and the rest yourself.

```js
import preset from './quality-rules/knip.mjs';

export default { ...preset, project: ['src/**/*.{ts,tsx}'] };
```

dependency-cruiser (`.dependency-cruiser.cjs`):

```js
module.exports = { extends: './quality-rules/dependency-cruiser.json' };
```

Project-specific rules go after these lines.

### ESLint and Prettier

Set `"toolchain": "eslint-prettier"` in the manifest. `sync` then writes `quality-rules/eslint.mjs` and `quality-rules/prettier.json` instead of the biome and oxlint files (knip and dependency-cruiser files are written in both cases). Install the packages that `eslint.mjs` imports; `sync` lists them.

```js
// eslint.config.mjs
import qualityRules from './quality-rules/eslint.mjs';

export default [...qualityRules, /* your own config */];
```

Prettier (`.prettierrc.json`):

```json
"./quality-rules/prettier.json"
```

In `prettier.config.mjs` you can spread the file and add your own settings after it. Files of the other toolchain left in `quality-rules/` are kept and reported.

## Conventions for review tools

The text of each convention is published in the package at `@reeschan/quality-rules-typescript/conventions/<ID>.md` (and `@reeschan/quality-rules-react/conventions/<ID>.md`). Review tools read the IDs in `resolved` and look for those files there.

## Other languages

See the [guide](docs/guides/adding-a-layer.md). This repository ships no template for them.

## License

MIT, see [LICENSE](LICENSE).
