/*---
description: `as const` makes an array literal a readonly tuple of literal types, without freezing it.
features: [ts-tuples, ts-as-const, ts-readonly]
---*/
const sizes = ["s", "m", "l"] as const;
type Size = (typeof sizes)[number];
function isSize(value: string): value is Size {
  return (sizes as readonly string[]).includes(value);
}
assert.sameValue(sizes.length, 3);
assert.sameValue(isSize("m"), true);
assert.sameValue(isSize("xl"), false);
assert.sameValue(Object.isFrozen(sizes), false);
