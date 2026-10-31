/*---
description: Control for name-module-isnan; the target resolves to the real isNaN builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-module-isnan.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function OwnisNaN(value: number): boolean { calls++; return value === value; }

function check(n: number): void {
  calls = 0;
  const result = isNaN(n);
  assert.sameValue(result, n !== n);
  assert.sameValue(calls, 0);
}
for (const n of [0, 1, NaN]) check(n);
