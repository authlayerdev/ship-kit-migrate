/**
 * tsx entry: parses argv and runs the CLI. Invoked by `cli.mjs`, which spawns
 * the local `tsx` runtime on this file so the TypeScript transforms load without
 * a build step. Kept separate from `cli-impl.ts` so the implementation stays
 * pure (exported `main`, no top-level side effects) and unit-testable.
 */
import { main } from "./cli-impl";

process.exitCode = main(process.argv.slice(2));
