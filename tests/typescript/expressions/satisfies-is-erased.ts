/*---
description: `satisfies` is erased: the expression's value and evaluation are unchanged.
features: [ts-satisfies]
---*/
let evaluations = 0;
function make(): { kind: string; size: number } {
  evaluations++;
  return { kind: "box", size: 2 };
}
const made = make() satisfies { kind: string };
const sizes = [1, 2] satisfies number[];
assert.sameValue(made.size, 2);
assert.sameValue(evaluations, 1);
assert.sameValue(sizes.length, 2);
