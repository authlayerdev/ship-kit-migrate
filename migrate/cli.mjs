#!/usr/bin/env node
/**
 * Buyer-facing CLI entry for the Ship Kit migration codemods.
 *
 *   node ./migrate/cli.mjs --transform <name> [--dry] <path>
 *   pnpm migrate -- --transform <name> [--dry] <path>
 *
 * The transforms are written in TypeScript (held to the kit's strict bar), so
 * this loader runs them through the locally-installed `tsx` runtime — no global
 * tooling and no build step, just `pnpm install`. We spawn the current Node on
 * tsx's own JS entry (rather than the `.bin/tsx` shell shim or an in-process
 * loader) because that is the most robust way to load on-the-fly TypeScript
 * across Node versions and platforms, including paths with spaces/non-ASCII.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const runner = join(here, "cli-run.ts");

// tsx ships a plain ESM entry we can run with the current Node executable; this
// sidesteps the platform-specific .bin shim entirely.
const tsxEntry = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

if (!existsSync(tsxEntry)) {
  process.stderr.write(
    "Could not find the local `tsx` runtime in node_modules. Run `pnpm install` " +
      "in the Ship Kit repo first, then re-run this command.\n",
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [tsxEntry, runner, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  process.stderr.write(
    `Failed to start the migration runner: ${err.message}\n`,
  );
  process.exit(1);
});
