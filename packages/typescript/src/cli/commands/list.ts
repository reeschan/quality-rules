import { type Catalog, type CatalogPack, loadCatalog } from '../../catalog/load.ts';
import type { CommandSpec } from '../main.ts';

/** `quality-rules list`: the packs, rules and conventions of the installed packages. */
export const listCommand: CommandSpec = {
  summary: 'List the packs, rules and conventions of the installed packages',
  options: {
    json: { type: 'boolean', description: 'Print the list as JSON' },
  },
  async run(values, io) {
    const catalog = await loadCatalog(io.cwd);
    io.out(
      values.json === true ? `${JSON.stringify(toJson(catalog), null, 2)}\n` : toText(catalog)
    );
    return 0;
  },
};

/** The list as data, for tools such as stack-setup that offer the packs as choices. */
function toJson(catalog: Catalog) {
  return {
    packages: catalog.packages.map((item) => ({ name: item.name, version: item.version })),
    packs: catalog.packs.map((pack) => ({
      name: pack.name,
      description: pack.description ?? null,
      packages: pack.packages,
      rules: pack.rules.map((rule) => ({
        id: rule.id,
        tool: rule.tool,
        description: rule.description,
        added: rule.added,
        package: rule.package,
        options: rule.options ?? null,
      })),
      conventions: pack.conventions.map((convention) => ({
        id: convention.id,
        layer: convention.layer,
        description: convention.title,
        added: convention.added,
        package: convention.package,
        check: convention.check,
      })),
    })),
  };
}

function toText(catalog: Catalog): string {
  const lines = [
    'Packages:',
    ...catalog.packages.map((item) => `  ${item.name} ${item.version}`),
    ...catalog.packs.flatMap((pack) => ['', ...packLines(pack)]),
    '',
  ];
  return lines.join('\n');
}

function packLines(pack: CatalogPack): string[] {
  const rows = [
    ...pack.rules.map((rule) => ({
      kind: 'rule',
      id: rule.id,
      tool: rule.tool,
      added: rule.added,
      description: rule.description,
    })),
    ...pack.conventions.map((convention) => ({
      kind: 'convention',
      id: convention.id,
      tool: convention.layer,
      added: convention.added,
      description:
        convention.check.length === 0
          ? convention.title
          : `${convention.title} (checked by ${convention.check.join(', ')})`,
    })),
  ];
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const toolWidth = Math.max(...rows.map((row) => row.tool.length));
  const heading = pack.description ?? 'Conventions only';
  return [
    `${pack.name}: ${heading} [${pack.packages.join(', ')}]`,
    ...rows.map(
      (row) =>
        `  ${row.kind.padEnd(10)}  ${row.id.padEnd(idWidth)}  ${row.tool.padEnd(toolWidth)}  added ${row.added}  ${row.description}`
    ),
  ];
}
