/*---
description: Control for name-parameter-number-isnan; the target resolves to the real Number builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-number-isnan.ts: pass the real builtin.
export {};
let calls: number = 0;
const OwnNumber: { isNaN(value: number): boolean } = {
  isNaN(value: number): boolean { calls++; return value === value; }
};

function check(Number: { isNaN(value: number): boolean }, n: number): void {
  calls = 0;
  const result = Number.isNaN(n);
  assert.sameValue(result, n !== n);
  assert.sameValue(calls, 0);
}
for (const n of [0, 1, NaN]) check(Number, n);
