import { describe, expect, it } from "vitest";

import { lineDiff } from "../cli-impl";

/**
 * `--dry` output must be reviewable: an inserted line is shown as ONE `+` line,
 * not as a cascade of misaligned -/+ pairs for every following line.
 */
describe("lineDiff (--dry output)", () => {
  it("returns an empty string for identical input", () => {
    expect(lineDiff("a\nb\nc", "a\nb\nc")).toBe("");
  });

  it("shows an inserted line as a single + with context, not a cascade", () => {
    const before = [
      "import x from 'x';",
      "",
      "export const a = 1;",
      "export const b = 2;",
    ].join("\n");
    const after = [
      "import x from 'x';",
      "import y from 'y';",
      "",
      "export const a = 1;",
      "export const b = 2;",
    ].join("\n");
    const out = lineDiff(before, after);
    const changed = out.split("\n").filter((l) => /^ {2}[+-] /.test(l));
    expect(changed).toEqual(["  + import y from 'y';"]);
    expect(out).toContain("    import x from 'x';");
  });

  it("pairs a replaced line as one - and one +", () => {
    const out = lineDiff("a\nold\nc", "a\nnew\nc");
    expect(out.split("\n")).toEqual(["    a", "  - old", "  + new", "    c"]);
  });

  it("separates distant changes into hunks with an ellipsis", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const after = [...lines];
    after[1] = "changed 1";
    after[18] = "changed 18";
    const out = lineDiff(lines.join("\n"), after.join("\n"));
    expect(out).toContain("  …");
    expect(out).toContain("  - line 1");
    expect(out).toContain("  + changed 18");
    expect(out).not.toContain("line 10");
  });

  it("handles pure deletion at the end", () => {
    const out = lineDiff("a\nb\nc", "a\nb");
    expect(out.split("\n")).toEqual(["    a", "    b", "  - c"]);
  });
});
