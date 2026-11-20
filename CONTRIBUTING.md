# Contributing

## Checks before a pull request

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Versions

The two published packages (`@reeschan/quality-rules-typescript` and `@reeschan/quality-rules-react`)
follow semver, so a user can read the effect of an upgrade from the version number.

| Change | Bump |
| --- | --- |
| Adds a rule or a convention (it reaches projects as a pending rule, never enabled by itself) | minor |
| Makes a default stricter: a lower limit, a rule that now flags more code, a rule moved into a pack that is on by default | major |
| Only fixes something: a wrong finding, a message, a bug in the CLI, a typo in a convention | patch |

When one change fits more than one row, take the highest bump.

## Changesets

Versions are raised with [changesets](https://github.com/changesets/changesets). The private
packages (`packages/rules`, `tools/lint-fixture-runner`, `examples/react-app`) are never versioned or
published.

1. In the pull request that changes a published package, run `pnpm changeset`.
2. Select the package or packages that changed and the bump from the table above.
3. Write the summary for a user reading the changelog: what changed for them, in one or two
   sentences. Name the rule or convention ID when there is one.
4. Commit the generated file in `.changeset/` with the change.

## Releasing

Only a maintainer releases. Contributors never push a `v*` tag.

1. Make sure the public repository is clean of any outside context. Check that public-guard is
   installed (`/public-guard:public-guard doctor`) and that it passes on the commits to publish.
2. On `main`, run `pnpm version-packages` (it runs `changeset version`), review the version bumps and
   the changelogs, and merge them through a pull request.
3. Push a tag that starts with `v` (for example `v0.2.0`) on the merged commit.
4. The `Release` workflow (`.github/workflows/release.yml`) runs on that tag push, or by hand from the
   Actions tab (`workflow_dispatch`). It installs with the frozen lockfile, runs typecheck, test and
   build, and then runs `changeset publish`. That publishes, with provenance and public access, only
   the versions that are not on npm yet.

The workflow needs the `@reeschan` scope on npm and a repository secret named `NPM_TOKEN`, both
provided by the maintainer.
