/*---
description: A parameter typed as a union of string literals takes each literal and selects a different branch.
features: [ts-unions, ts-literal-types]
---*/
type Align = "left" | "right" | "center";
function pad(text: string, width: number, align: Align): string {
  const space = width - text.length;
  if (align === "left") return text + ".".repeat(space);
  if (align === "right") return ".".repeat(space) + text;
  const before = Math.floor(space / 2);
  return ".".repeat(before) + text + ".".repeat(space - before);
}
assert.sameValue(pad("ab", 5, "left"), "ab...");
assert.sameValue(pad("ab", 5, "right"), "...ab");
assert.sameValue(pad("ab", 5, "center"), ".ab..");
