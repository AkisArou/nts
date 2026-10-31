/*---
description: A module-scoped Object namesake keeps its own assign implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects]
flags: [module]
---*/
// Route: module binding named Object; node runs the program's own implementation.
export {};
let calls: number = 0;
const Object: { assign(target: { value: number }, source: { value: number }): { value: number } } = {
  assign(target: { value: number }, source: { value: number }): { value: number } {
    calls++; target.value = source.value + 100; return target;
  }
};

function check(n: number): void {
  calls = 0;
  const target: { value: number } = { value: 0 };
  const result = Object.assign(target, { value: n });
  assert.sameValue(result, target);
  assert.sameValue(result.value, n + 100);
  assert.sameValue(calls, 1);
}
for (const n of [1, 3, 7]) check(n);
