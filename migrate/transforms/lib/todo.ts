/**
 * Helpers for emitting honest, greppable migration markers.
 *
 * When a codemod can't safely complete a transform, it must FAIL LOUDLY in the
 * output rather than guess: it leaves a `// TODO(ship-kit): …` comment the buyer
 * resolves by hand. Every marker uses the same prefix so a buyer can grep their
 * whole tree for remaining work after a run:
 *
 *     grep -rn "TODO(ship-kit)" .
 */
import type { Collection, JSCodeshift, ASTPath } from "jscodeshift";

export const TODO_PREFIX = "TODO(ship-kit):";

/** A line comment node carrying a `TODO(ship-kit):` message. */
export function todoComment(j: JSCodeshift, message: string) {
  return j.commentLine(` ${TODO_PREFIX} ${message}`, true, false);
}

/**
 * Prepend a `TODO(ship-kit):` line comment to a node, idempotently: if the node
 * already carries a comment with the same message it is not added again, so
 * running the transform twice does not stack duplicate TODOs.
 */
export function attachTodo(
  j: JSCodeshift,
  path: ASTPath,
  message: string,
): void {
  const node = path.node as { comments?: unknown[] };
  const existing = (node.comments ?? []) as Array<{ value?: string }>;
  const text = ` ${TODO_PREFIX} ${message}`;
  if (existing.some((c) => c.value === text)) return;
  node.comments = [...existing, j.commentLine(text, true, false)];
}

/**
 * Whether the file already imports from `better-auth` (any specifier). Used to
 * keep the transform idempotent: a second run on already-migrated code should be
 * a no-op rather than re-injecting imports/markers.
 */
export function importsBetterAuth(j: JSCodeshift, root: Collection): boolean {
  return (
    root
      .find(j.ImportDeclaration)
      .filter((p) => {
        const src = p.node.source.value;
        return typeof src === "string" && src.startsWith("better-auth");
      })
      .size() > 0
  );
}
