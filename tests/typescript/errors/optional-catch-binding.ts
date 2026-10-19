/*---
description: A catch clause without a binding handles the exception without naming it.
features: [ts-errors]
---*/
function safeParse(text: string): number | undefined {
  try {
    return JSON.parse(text) as number;
  } catch {
    return undefined;
  }
}
assert.sameValue(safeParse("12"), 12);
assert.sameValue(safeParse("nope"), undefined);
