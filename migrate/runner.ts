/**
 * Programmatic transform runner.
 *
 * `applyTransform` invokes a jscodeshift transform on a string of source code
 * the same way the jscodeshift CLI would (building the `{ jscodeshift, j, stats,
 * report }` API with the parser forced to TSX), and returns the result. This is
 * the shared engine behind both the fixture harness and the file CLI, so a
 * transform behaves identically in tests and in a buyer's project.
 *
 * A transform may return:
 *   - a `string`  → the new file contents,
 *   - `undefined`/`null`/the original source → "no change".
 * `applyTransform` normalises that into `{ source, changed }`.
 */
import jscodeshift from "jscodeshift";
import type { API, FileInfo, Options, Transform } from "jscodeshift";
import { getTransform } from "./registry";
import { TRANSFORM_PARSER } from "./types";

export interface ApplyResult {
  /** Resulting source (the original, unchanged, when the transform made no edit). */
  readonly source: string;
  /** True when the transform actually changed the source. */
  readonly changed: boolean;
}

/** Build the jscodeshift `api` object exactly as the CLI does, TSX parser forced. */
function buildApi(): API {
  const j = jscodeshift.withParser(TRANSFORM_PARSER);
  return {
    j,
    jscodeshift: j,
    stats: () => {
      // The CLI uses stats() for dry-run reporting; transforms in this kit don't
      // rely on it, so a no-op keeps the surface honest without hidden state.
    },
    report: () => {
      // Same: report() prints to the CLI; unused by our transforms.
    },
  };
}

/**
 * Detect the dominant line ending of a source so we can keep the output in the
 * same style. recast prints with the host OS's line ending by default, which
 * would otherwise flip every line of an LF file to CRLF on Windows (and vice
 * versa) and report a spurious change — breaking determinism and idempotency.
 */
function detectEol(source: string): "\r\n" | "\n" {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? "\r\n" : "\n";
}

/** Apply an already-resolved transform function to a source string. */
export function applyTransform(
  transform: Transform,
  source: string,
  options: {
    /** Virtual path passed to the transform as `file.path` (affects nothing structural). */
    path?: string;
    /** Extra options forwarded to the transform (jscodeshift `options`). */
    transformOptions?: Options;
  } = {},
): ApplyResult {
  const file: FileInfo = { path: options.path ?? "input.tsx", source };
  const api = buildApi();
  const out = transform(file, api, options.transformOptions ?? {});

  // The migration codemods are all synchronous; jscodeshift's `Transform` type
  // also permits a Promise, which we deliberately don't support here (a sync
  // string→string contract keeps the runner and the harness simple).
  if (out instanceof Promise) {
    throw new Error(
      "Asynchronous transforms are not supported by the Ship Kit runner. " +
        "Make the transform synchronous (return the new source string).",
    );
  }

  if (out == null) {
    return { source, changed: false };
  }

  // Normalise the output's line endings to the source's style so the result is
  // deterministic across OSes and a true no-op stays a no-op.
  const eol = detectEol(source);
  const normalised = out.replace(/\r\n/g, "\n").replace(/\n/g, eol);

  if (normalised === source) {
    return { source, changed: false };
  }
  return { source: normalised, changed: true };
}

/** Apply a transform by its registry name. Throws on an unknown name. */
export function applyNamedTransform(
  name: string,
  source: string,
  options?: { path?: string; transformOptions?: Options },
): ApplyResult {
  const entry = getTransform(name);
  if (!entry) {
    throw new Error(
      `Unknown transform "${name}". Run with --help to see the available transforms.`,
    );
  }
  return applyTransform(entry.transform, source, options);
}
