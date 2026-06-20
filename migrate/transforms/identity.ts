/**
 * Identity transform — a deliberate no-op.
 *
 * It parses the file and prints it back unchanged. It exists to prove the
 * fixture harness and the CLI end-to-end without depending on any real
 * migration logic: its corpus is `input === output`, so a green identity
 * fixture means "the runner parses, the printer round-trips, the harness
 * compares correctly." Real transforms (nextauth, clerk) are tested the same
 * way against meaningful before/after pairs.
 */
import type { API, FileInfo } from "jscodeshift";

export default function transform(file: FileInfo, api: API): string {
  const j = api.jscodeshift;
  const root = j(file.source);
  // No edits. Returning the printed AST (rather than `file.source`) is the
  // honest no-op: it also confirms the parse/print round-trip is clean.
  return root.toSource();
}
