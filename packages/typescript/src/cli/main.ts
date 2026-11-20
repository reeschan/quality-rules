#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { QualityRulesError } from '../errors.ts';
import { checkCommand } from './commands/check.ts';
import { duplicationCommand } from './commands/duplication.ts';
import { listCommand } from './commands/list.ts';
import { suppressionsCommand } from './commands/suppressions.ts';
import { syncCommand } from './commands/sync.ts';
import { unitTestsCommand } from './commands/unit-tests.ts';

/** Where a command reads the project and writes its output. */
export interface CommandIo {
  /** The project folder: `--cwd`, or the current folder. */
  readonly cwd: string;
  out(text: string): void;
  err(text: string): void;
}

/** One option of a command, in the shape `node:util` `parseArgs` takes. */
export interface OptionSpec {
  readonly type: 'string' | 'boolean';
  readonly multiple?: boolean;
  readonly short?: string;
  readonly description: string;
  /** What the value of a string option is, shown in the help as `--name <valueName>`. */
  readonly valueName?: string;
}

/** Values of the parsed options, by option name. */
export type OptionValues = Readonly<
  Record<string, string | boolean | (string | boolean)[] | undefined>
>;

/** A subcommand of `quality-rules`. */
export interface CommandSpec {
  readonly summary: string;
  readonly options: Readonly<Record<string, OptionSpec>>;
  /** Runs the command and returns the exit code: 0 when it passes, 1 when a check fails. */
  run(values: OptionValues, io: CommandIo): Promise<number>;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  list: listCommand,
  sync: syncCommand,
  check: checkCommand,
  duplication: duplicationCommand,
  'unit-tests': unitTestsCommand,
  suppressions: suppressionsCommand,
};

const COMMON_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  cwd: { type: 'string', description: 'Project folder (default: the current folder)' },
  help: { type: 'boolean', short: 'h', description: 'Show help' },
};

/** Exit code for a broken manifest, catalog or command line. */
const EXIT_ERROR = 2;

function usage(): string {
  const commandLines = Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name.padEnd(13)}${command.summary}`
  );
  const optionLines = (options: Readonly<Record<string, OptionSpec>>) =>
    Object.entries(options).map(([name, option]) => {
      const flag =
        option.type === 'string' ? `--${name} <${option.valueName ?? 'value'}>` : `--${name}`;
      return `  ${flag.padEnd(18)}${option.description}`;
    });
  const commandOptions = Object.entries(COMMANDS).flatMap(([name, command]) => {
    const lines = optionLines(command.options);
    return lines.length === 0 ? [] : ['', `Options of ${name}:`, ...lines];
  });
  return [
    'Usage: quality-rules <command> [options]',
    '',
    'Commands:',
    ...commandLines,
    '',
    'Options:',
    ...optionLines(COMMON_OPTIONS),
    ...commandOptions,
    '',
  ].join('\n');
}

/** Runs the CLI with the arguments after the executable and returns the exit code. */
export async function main(argv: readonly string[], io: Omit<CommandIo, 'cwd'>): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    io.out(usage());
    return name === undefined ? EXIT_ERROR : 0;
  }
  const command = COMMANDS[name];
  if (command === undefined) {
    io.err(`Unknown command "${name}".\n\n${usage()}`);
    return EXIT_ERROR;
  }
  try {
    const { values } = parseArgs({
      args: [...rest],
      options: { ...COMMON_OPTIONS, ...command.options },
      allowPositionals: false,
      strict: true,
    });
    if (values.help === true) {
      io.out(usage());
      return 0;
    }
    const cwd = path.resolve(typeof values.cwd === 'string' ? values.cwd : process.cwd());
    return await command.run(values, { ...io, cwd });
  } catch (error) {
    if (error instanceof QualityRulesError || isArgumentError(error)) {
      io.err(`quality-rules ${name}: ${error.message}\n`);
      return EXIT_ERROR;
    }
    throw error;
  }
}

/** Errors that `parseArgs` throws for unknown or malformed options. */
function isArgumentError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('ERR_PARSE_ARGS_')
  );
}

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
