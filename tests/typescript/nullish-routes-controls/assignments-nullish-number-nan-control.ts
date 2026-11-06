/*---
description: "Nullish assignment preserves NaN in number storage. Route: declared variable type (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment preserves NaN in number storage. Route: declared variable type. Node prints assignments-nullish-number-nan:ok.
let value: number | undefined = NaN;
const log: string[] = [];
function next(): number | undefined { log.push("rhs"); return 4; }
const saved = value; let result: number | undefined = saved;
if (saved === null || saved === undefined) { const nextValue = next(); value = nextValue; result = nextValue; }
assert.sameValue(result, NaN);
assert.sameValue(value, NaN);
assert.compareArray(log, []);
console.log("assignments-nullish-number-nan:ok");
