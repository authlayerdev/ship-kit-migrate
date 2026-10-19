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
 *   - --dry prints an aligned line diff (with context) and writes nothing.
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

const DEFAULT_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mts",
  "cts",
  "mjs",
  "cjs",
];
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
  const rows = TRANSFORMS.map(
    (t) => `    ${t.name.padEnd(12)} ${t.summary}`,
  ).join("\n");
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

/** Lines of unchanged context shown around each change in --dry output. */
const DIFF_CONTEXT = 2;
/** Above this many LCS cells (lines × lines) we skip alignment and show a block replace. */
const DIFF_MAX_CELLS = 4_000_000;

/**
 * Line-level diff for --dry output (no dependency).
 *
 * Aligns the two versions with a longest-common-subsequence table, so an
 * inserted line (e.g. a new `import`) shows up as one `+` line instead of
 * shifting every following line into a bogus -/+ pair. Changes are grouped into
 * hunks with `DIFF_CONTEXT` unchanged lines around them; hunks are separated by
 * `  …`. Unchanged input returns "". Exported for tests.
 */
export function lineDiff(before: string, after: string): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;

  type Op = { kind: " " | "-" | "+"; text: string };
  const ops: Op[] = [];

  if (n * m > DIFF_MAX_CELLS) {
    for (const text of a) ops.push({ kind: "-", text });
    for (const text of b) ops.push({ kind: "+", text });
  } else {
    // lcs[i][j] = LCS length of a[i..] and b[j..], stored row-major.
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    const at = (i: number, j: number): number => lcs[i * w + j] ?? 0;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          a[i] === b[j]
            ? at(i + 1, j + 1) + 1
            : Math.max(at(i + 1, j), at(i, j + 1));
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const left = a[i] ?? "";
      const right = b[j] ?? "";
      if (left === right) {
        ops.push({ kind: " ", text: left });
        i++;
        j++;
      } else if (at(i + 1, j) >= at(i, j + 1)) {
        ops.push({ kind: "-", text: left });
        i++;
      } else {
        ops.push({ kind: "+", text: right });
        j++;
      }
    }
    for (; i < n; i++) ops.push({ kind: "-", text: a[i] ?? "" });
    for (; j < m; j++) ops.push({ kind: "+", text: b[j] ?? "" });
  }

  // Keep only changed lines plus DIFF_CONTEXT lines of context around them.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === " ") return;
    const from = Math.max(0, idx - DIFF_CONTEXT);
    const to = Math.min(ops.length - 1, idx + DIFF_CONTEXT);
    for (let k = from; k <= to; k++) keep[k] = true;
  });

  const out: string[] = [];
  let last = -1;
  ops.forEach((op, idx) => {
    if (!keep[idx]) return;
    if (last !== -1 && idx > last + 1) out.push("  …");
    out.push(`  ${op.kind} ${op.text}`.replace(/\s+$/, ""));
    last = idx;
  });
  return out.join("\n");
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

  if (args.help || argv.length === 0) {
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
    process.stderr.write(
      "No <path> given. Pass a file or directory to transform.\n",
    );
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
