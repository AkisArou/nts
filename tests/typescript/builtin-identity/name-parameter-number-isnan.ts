/*---
description: A parameter-scoped Number namesake keeps its own isnan implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: typed parameter named Number; node runs the program's own implementation.
export {};
let calls: number = 0;
const OwnNumber: { isNaN(value: number): boolean } = {
  isNaN(value: number): boolean { calls++; return value === value; }
};

function check(Number: { isNaN(value: number): boolean }, n: number): void {
  calls = 0;
  const result = Number.isNaN(n);
  assert.sameValue(result, n === n);
  assert.sameValue(calls, 1);
}
for (const n of [0, 1, NaN]) check(OwnNumber, n);
