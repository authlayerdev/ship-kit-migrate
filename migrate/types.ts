/**
 * Shared types for the Ship Kit migration codemods.
 *
 * A "transform" is a standard jscodeshift transform module: a default export
 * with the signature `(file, api, options) => string | null | undefined`. The
 * `runner` applies one to a string of source code; the `cli` applies one across
 * a directory of files; the `fixtures` harness asserts one against its corpus.
 */
import type { Transform } from "jscodeshift";

/** A registered, buyer-runnable transform. */
export interface TransformEntry {
  /** CLI name, e.g. `nextauth` (used as `--transform nextauth`). */
  readonly name: string;
  /** One-line description shown in `--help`. */
  readonly summary: string;
  /** The jscodeshift transform itself. */
  readonly transform: Transform;
}

/**
 * jscodeshift parses by file extension. We force the TypeScript+TSX parser so a
 * `.ts`/`.tsx`/`.js`/`.jsx` buyer file is always parsed with full TS syntax
 * support (decorators, type annotations, JSX). `tsx` is a superset that accepts
 * plain TS too, so it is the safe single choice for the whole corpus.
 */
export const TRANSFORM_PARSER = "tsx" as const;
