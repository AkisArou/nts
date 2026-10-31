/*---
description: Control for name-parameter-isnan; the target resolves to the real isNaN builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-function-types, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-isnan.ts: pass the real builtin.
export {};
let calls: number = 0;
function OwnisNaN(value: number): boolean { calls++; return value === value; }

function check(isNaN: (value: number) => boolean, n: number): void {
  calls = 0;
  const result = isNaN(n);
  assert.sameValue(result, n !== n);
  assert.sameValue(calls, 0);
}
for (const n of [0, 1, NaN]) check(isNaN, n);
