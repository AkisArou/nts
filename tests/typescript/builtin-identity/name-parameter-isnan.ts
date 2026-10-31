/*---
description: A parameter-scoped isNaN namesake keeps its own isnan implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-function-types, ts-numbers]
flags: [module]
---*/
// Route: typed parameter named isNaN; node runs the program's own implementation.
export {};
let calls: number = 0;
function OwnisNaN(value: number): boolean { calls++; return value === value; }

function check(isNaN: (value: number) => boolean, n: number): void {
  calls = 0;
  const result = isNaN(n);
  assert.sameValue(result, n === n);
  assert.sameValue(calls, 1);
}
for (const n of [0, 1, NaN]) check(OwnisNaN, n);
