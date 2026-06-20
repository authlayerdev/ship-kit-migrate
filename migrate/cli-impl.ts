/**
 * CLI implementation for `ship-kit-migrate`.
 *
 * Buyer-facing entry is `cli.mjs` (a thin loader that registers the TS runtime
 * and calls `main()` here). Kept in TypeScript so the tool is held to the same
 * strict-typed bar as the rest of the kit.
 *
 * Usage:
 *   node ./migrate/cli.mjs --transform <name> [--dry] [--ext ts,tsx,js,jsx] <path>
 *
 * Behaviour:
 *   - <path> may be a single file or a directory (walked recursively).
 *   - --dry prints a unified-ish summary diff and writes nothing.
 *   - Without --dry, changed files are rewritten in place; unchanged files are
 *     left untouched. Exit code is 0 on success, 1 on a usage/IO error.
 */
import {
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, extname, relative } from "node:path";
import { applyTransform } from "./runner";
import { getTransform, transformNames, TRANSFORMS } from "./registry";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
]);

interface ParsedArgs {
  transform?: string;
  dry: boolean;
  help: boolean;
  extensions: string[];
  paths: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    dry: false,
    help: false,
    extensions: DEFAULT_EXTENSIONS,
    paths: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--dry":
      case "--dry-run":
        args.dry = true;
        break;
      case "-t":
      case "--transform":
        args.transform = argv[++i];
        break;
      case "--ext":
      case "--extensions": {
        const value = argv[++i];
        if (value) {
          args.extensions = value
            .split(",")
            .map((e) => e.trim().replace(/^\./, ""))
            .filter(Boolean);
        }
        break;
      }
      default:
        if (arg && arg.startsWith("--transform=")) {
          args.transform = arg.slice("--transform=".length);
        } else if (arg && arg.startsWith("-")) {
          throw new UsageError(`Unknown option: ${arg}`);
        } else if (arg) {
          args.paths.push(arg);
        }
    }
  }
  return args;
}

class UsageError extends Error {}

function helpText(): string {
  const rows = TRANSFORMS.map((t) => `    ${t.name.padEnd(12)} ${t.summary}`).join("\n");
  return `ship-kit-migrate — assisted Better Auth migration codemods

USAGE
  node ./migrate/cli.mjs --transform <name> [options] <path>

ARGUMENTS
  <path>                 A file or directory to transform (directories are
                         walked recursively; ${[...SKIP_DIRS].join(", ")} are skipped).

OPTIONS
  -t, --transform <name> Which transform to run (required). See TRANSFORMS below.
      --dry, --dry-run   Preview changes; write nothing.
      --ext <list>       Comma-separated extensions to process
                         (default: ${DEFAULT_EXTENSIONS.join(",")}).
  -h, --help             Show this help.

TRANSFORMS
${rows}

EXAMPLES
  # Preview the NextAuth migration on ./src without writing:
  node ./migrate/cli.mjs --transform nextauth --dry ./src

  # Apply it:
  node ./migrate/cli.mjs --transform nextauth ./src

These codemods are deterministic and idempotent. Anything they can't safely
transform is left as a "// TODO(ship-kit):" comment for you to resolve — see the
migration guide for the manual remainder. They are an assist, not magic.
`;
}

function collectFiles(target: string, extensions: Set<string>): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).replace(/^\./, "");
        if (extensions.has(ext)) files.push(join(dir, entry.name));
      }
    }
  };
  walk(target);
  return files;
}

/** Tiny line-level diff for --dry output (no dependency, good enough to review). */
function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) lines.push(`  - ${a[i]}`);
      if (b[i] !== undefined) lines.push(`  + ${b[i]}`);
    }
  }
  return lines.join("\n");
}

export function main(argv: string[]): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\n${helpText()}`);
      return 1;
    }
    throw err;
  }

  if (args.help || (argv.length === 0)) {
    process.stdout.write(helpText());
    return args.help ? 0 : 1;
  }

  if (!args.transform) {
    process.stderr.write(
      `Missing --transform. Available: ${transformNames().join(", ")}\n`,
    );
    return 1;
  }

  const entry = getTransform(args.transform);
  if (!entry) {
    process.stderr.write(
      `Unknown transform "${args.transform}". Available: ${transformNames().join(", ")}\n`,
    );
    return 1;
  }

  if (args.paths.length === 0) {
    process.stderr.write("No <path> given. Pass a file or directory to transform.\n");
    return 1;
  }

  const extensions = new Set(args.extensions);
  const targets: string[] = [];
  for (const p of args.paths) {
    if (!existsSync(p)) {
      process.stderr.write(`Path does not exist: ${p}\n`);
      return 1;
    }
    targets.push(...collectFiles(p, extensions));
  }

  if (targets.length === 0) {
    process.stdout.write("No matching files found.\n");
    return 0;
  }

  let changedCount = 0;
  const cwd = process.cwd();

  for (const file of targets) {
    const source = readFileSync(file, "utf8");
    let result;
    try {
      result = applyTransform(entry.transform, source, { path: file });
    } catch (err) {
      // Fail loudly per-file but keep going so one unparseable file doesn't
      // abort the whole run. The buyer sees exactly which file needs attention.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`! ${relative(cwd, file)}: ${message}\n`);
      continue;
    }

    if (!result.changed) continue;
    changedCount++;
    const rel = relative(cwd, file);

    if (args.dry) {
      process.stdout.write(`~ ${rel}\n${lineDiff(source, result.source)}\n\n`);
    } else {
      writeFileSync(file, result.source, "utf8");
      process.stdout.write(`~ ${rel}\n`);
    }
  }

  const verb = args.dry ? "would change" : "changed";
  process.stdout.write(
    `\n${entry.name}: ${verb} ${changedCount} of ${targets.length} file(s).` +
      (args.dry && changedCount > 0
        ? " Re-run without --dry to apply.\n"
        : "\n"),
  );
  return 0;
}
