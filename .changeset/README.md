# Changesets

Every change that affects a published package needs a changeset. Write one with `pnpm changeset`,
commit the generated file with the change, and follow the version rules in `CONTRIBUTING.md`.

The private packages (`packages/rules`, `tools/lint-fixture-runner`, `examples/react-app`) are
never versioned or published.
