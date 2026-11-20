import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Folder of the TypeScript package (`packages/typescript`). */
export const packageDir = fileURLToPath(new URL('../../../', import.meta.url));

/** Version 1 of the sample package, laid out as it is when installed. */
export const sampleV1Dir = fileURLToPath(new URL('../../fixtures/packages/v1/', import.meta.url));

/** Name of the TypeScript package as projects install it. */
export const typescriptPackageName = '@reeschan/quality-rules-typescript';

const cliPath = path.join(packageDir, 'src', 'cli', 'main.ts');
const bundleScriptPath = path.join(packageDir, 'scripts', 'bundle-conventions.ts');
const require = createRequire(import.meta.url);

/** Exit code and output of a process. */
export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One diagnostic of oxlint, with the rule as `plugin(rule)` the way oxlint prints it. */
export interface OxlintFinding {
  readonly file: string;
  readonly code: string;
  readonly message: string;
}

/** One diagnostic of Biome, with its category such as `lint/suspicious/noConsole` or `format`. */
export interface BiomeFinding {
  readonly file: string;
  readonly category: string;
  readonly message: string;
}

/** One message of ESLint, with the rule ID (`null` for messages of no rule). */
export interface EslintFinding {
  /** Path relative to the project, with `/` separators. */
  readonly file: string;
  readonly line: number;
  readonly ruleId: string | null;
  readonly message: string;
}

/** Runs Node with the arguments in `cwd` and resolves with the exit code and output. */
export function runNode(args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ exitCode: error === null ? 0 : Number(error.code), stdout, stderr });
      }
    );
  });
}

function binOf(packageName: string, binName: string): string {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = require(manifestPath) as { bin: string | Record<string, string> };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[binName];
  if (bin === undefined) {
    throw new Error(`${packageName} has no ${binName} executable`);
  }
  return path.join(path.dirname(manifestPath), bin);
}

/** A project in a temporary folder, with helpers to run the CLI and the linters on it. */
export class TempProject {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Absolute path of a file of the project, from `/`-separated segments. */
  path(file: string): string {
    return path.join(this.dir, ...file.split('/'));
  }

  /** Writes a file (objects as JSON), creating its folder. */
  async write(file: string, content: string | object): Promise<void> {
    const target = this.path(file);
    await mkdir(path.dirname(target), { recursive: true });
    const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    await writeFile(target, text);
  }

  read(file: string): Promise<string> {
    return readFile(this.path(file), 'utf8');
  }

  async readJson<T = Record<string, unknown>>(file: string): Promise<T> {
    return JSON.parse(await this.read(file)) as T;
  }

  /** Writes the manifest `quality-rules.json`. */
  writeManifest(manifest: object): Promise<void> {
    return this.write('quality-rules.json', manifest);
  }

  /** Runs the `quality-rules` CLI from the sources in the project folder. */
  cli(...args: string[]): Promise<RunResult> {
    return runNode([cliPath, ...args], this.dir);
  }

  /** Runs oxlint with the project's configuration on the given paths. */
  async oxlint(...paths: string[]): Promise<OxlintFinding[]> {
    const result = await runNode(
      [binOf('oxlint', 'oxlint'), '--format', 'json', ...paths],
      this.dir
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`oxlint failed (exit ${result.exitCode}):\n${result.stderr}${result.stdout}`);
    }
    const report = JSON.parse(result.stdout) as {
      diagnostics: { filename: string; code?: string; message: string }[];
    };
    return report.diagnostics.map((diagnostic) => ({
      file: diagnostic.filename.split(path.sep).join('/'),
      code: diagnostic.code ?? '',
      message: diagnostic.message,
    }));
  }

  /** Runs `biome check` with the project's configuration on the given paths. */
  async biome(...paths: string[]): Promise<BiomeFinding[]> {
    const result = await runNode(
      [binOf('@biomejs/biome', 'biome'), 'check', '--reporter=json', ...paths],
      this.dir
    );
    const start = result.stdout.indexOf('{');
    if (start === -1) {
      throw new Error(`biome failed (exit ${result.exitCode}):\n${result.stderr}${result.stdout}`);
    }
    const report = JSON.parse(result.stdout.slice(start)) as {
      diagnostics: { category: string; message: string; location?: { path?: string } }[];
    };
    return report.diagnostics.map((diagnostic) => ({
      file: (diagnostic.location?.path ?? '').split('\\').join('/'),
      category: diagnostic.category,
      message: diagnostic.message,
    }));
  }

  /** Runs ESLint with the project's `eslint.config.mjs` on the given paths. */
  async eslint(...paths: string[]): Promise<EslintFinding[]> {
    const result = await runNode(
      [binOf('eslint', 'eslint'), '--format', 'json', ...paths],
      this.dir
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`eslint failed (exit ${result.exitCode}):\n${result.stderr}${result.stdout}`);
    }
    const report = JSON.parse(result.stdout) as {
      filePath: string;
      messages: { line: number; ruleId: string | null; message: string }[];
    }[];
    return report.flatMap((entry) =>
      entry.messages.map((message) => ({
        file: path.relative(this.dir, entry.filePath).split(path.sep).join('/'),
        line: message.line,
        ruleId: message.ruleId,
        message: message.message,
      }))
    );
  }

  /**
   * Runs `prettier --list-different` with the project's configuration on the given paths and
   * returns the files that Prettier would change, relative to the project with `/` separators.
   */
  async prettierDifferences(...paths: string[]): Promise<string[]> {
    const result = await runNode(
      [binOf('prettier', 'prettier'), '--list-different', ...paths],
      this.dir
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `prettier failed (exit ${result.exitCode}):\n${result.stderr}${result.stdout}`
      );
    }
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line !== '')
      .map((line) => line.split('\\').join('/'))
      .sort();
  }

  /**
   * Makes a package that is installed for this repository importable from the project, by
   * writing `node_modules/<name>` with an entry module that re-exports the installed one (no
   * links, so deleting the project never reaches the repository's folders). `fromDir` is the
   * folder whose dependencies have the package.
   */
  async installShim(name: string, fromDir: string): Promise<void> {
    const entry = createRequire(path.join(fromDir, 'package.json')).resolve(name);
    const url = JSON.stringify(pathToFileURL(entry).href);
    const target = this.path(`node_modules/${name}`);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'index.mjs'), `export { default } from ${url};\n`);
    await writeFile(
      path.join(target, 'package.json'),
      `${JSON.stringify({ name, version: '0.0.0', type: 'module', exports: './index.mjs' }, null, 2)}\n`
    );
  }

  /** Adds a package to the devDependencies of the project's package.json. */
  async addDependency(name: string, version: string): Promise<void> {
    const manifest = await this.readJson<{ devDependencies?: Record<string, string> }>(
      'package.json'
    );
    manifest.devDependencies = { ...manifest.devDependencies, [name]: version };
    await this.write('package.json', manifest);
  }

  /**
   * Installs a package from a folder in its installed layout (such as the sample package) into
   * `node_modules`, and lists it in package.json. Returns the installed folder.
   */
  async installPackage(sourceDir: string): Promise<string> {
    const manifest = JSON.parse(await readFile(path.join(sourceDir, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    const target = this.path(`node_modules/${manifest.name}`);
    await cp(sourceDir, target, { recursive: true });
    await this.addDependency(manifest.name, manifest.version);
    return target;
  }

  /**
   * Installs this repository's TypeScript package as a project gets it from npm: package.json,
   * the packs, the conventions bundled from the repository's sources, and an entry module that
   * exports the custom rules (here from the TypeScript sources, so no build is needed).
   */
  async installTypescriptPackage(): Promise<string> {
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      qualityRules: { packs: string; conventions: string };
    };
    const target = this.path(`node_modules/${manifest.name}`);
    await mkdir(target, { recursive: true });
    await cp(path.join(packageDir, manifest.qualityRules.packs), path.join(target, 'packs'), {
      recursive: true,
    });
    const bundled = await runNode(
      [bundleScriptPath, '--out', path.join(target, manifest.qualityRules.conventions)],
      packageDir
    );
    if (bundled.exitCode !== 0) {
      throw new Error(`bundle-conventions failed:\n${bundled.stderr}${bundled.stdout}`);
    }
    const pluginUrl = pathToFileURL(path.join(packageDir, 'src', 'plugin.ts')).href;
    await writeFile(
      path.join(target, 'index.mjs'),
      `export * from ${JSON.stringify(pluginUrl)};\n`
    );
    await writeFile(
      path.join(target, 'package.json'),
      `${JSON.stringify(
        {
          name: manifest.name,
          version: manifest.version,
          type: 'module',
          exports: { '.': './index.mjs', './package.json': './package.json' },
          qualityRules: manifest.qualityRules,
        },
        null,
        2
      )}\n`
    );
    await this.addDependency(manifest.name, manifest.version);
    return target;
  }

  /** Deletes the project folder. */
  remove(): Promise<void> {
    return rm(this.dir, { recursive: true, force: true });
  }
}

/** Creates an empty project (a package.json only) in a new temporary folder. */
export async function createTempProject(): Promise<TempProject> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'quality-rules-cli-'));
  const project = new TempProject(dir);
  await project.write('package.json', { name: 'sample-project', private: true, type: 'module' });
  return project;
}

/** Creates projects for a test file and deletes them all at the end. */
export function projectPool(): { create(): Promise<TempProject>; removeAll(): Promise<void> } {
  const projects: TempProject[] = [];
  return {
    async create() {
      const project = await createTempProject();
      projects.push(project);
      return project;
    },
    async removeAll() {
      await Promise.all(projects.splice(0).map((project) => project.remove()));
    },
  };
}
