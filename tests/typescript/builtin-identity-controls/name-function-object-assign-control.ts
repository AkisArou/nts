/*---
description: Control for name-function-object-assign; the target resolves to the real Object builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects]
flags: [module]
---*/
// Control for ../builtin-identity/name-function-object-assign.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(n: number): void {
  const OwnObject: { assign(target: { value: number }, source: { value: number }): { value: number } } = {
    assign(target: { value: number }, source: { value: number }): { value: number } {
      calls++; target.value = source.value + 100; return target;
    }
  };
  calls = 0;
  const target: { value: number } = { value: 0 };
  const result = Object.assign(target, { value: n });
  assert.sameValue(result, target);
  assert.sameValue(result.value, n);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(n);
