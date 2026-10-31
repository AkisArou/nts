/*---
description: A function-scoped Number namesake keeps its own isnan implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: function binding named Number; node runs the program's own implementation.
export {};
let calls: number = 0;
function check(n: number): void {
  const Number: { isNaN(value: number): boolean } = {
    isNaN(value: number): boolean { calls++; return value === value; }
  };
  calls = 0;
  const result = Number.isNaN(n);
  assert.sameValue(result, n === n);
  assert.sameValue(calls, 1);
}
for (const n of [0, 1, NaN]) check(n);
