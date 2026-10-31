/*---
description: Control for name-function-number-isnan; the target resolves to the real Number builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-function-number-isnan.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(n: number): void {
  const OwnNumber: { isNaN(value: number): boolean } = {
    isNaN(value: number): boolean { calls++; return value === value; }
  };
  calls = 0;
  const result = Number.isNaN(n);
  assert.sameValue(result, n !== n);
  assert.sameValue(calls, 0);
}
for (const n of [0, 1, NaN]) check(n);
