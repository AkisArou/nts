/*---
description: The comma operator yields its last operand and void yields undefined, each evaluating every operand.
features: [ts-expressions]
---*/
let steps = 0;
const last = (steps++, steps++, steps * 10);
const nothing = void steps++;
assert.sameValue(last, 20);
assert.sameValue(nothing, undefined);
assert.sameValue(steps, 3);
