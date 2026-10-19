/*---
description: A non-null assertion inside an optional chain does not end it; parentheses around the chain do.
features: [ts-non-null, ts-optional-chaining]
---*/
type Tree = { child?: { label?: string } };
const missing: Tree | undefined = undefined as Tree | undefined;
const inChain = missing?.child!.label;
assert.sameValue(inChain, undefined);
assert.throws(TypeError, () => {
  (missing?.child)!.label;
});
const present: Tree | undefined = { child: { label: "leaf" } };
assert.sameValue(present?.child!.label, "leaf");
