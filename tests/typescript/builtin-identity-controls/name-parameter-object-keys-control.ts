/*---
description: Control for name-parameter-object-keys; the target resolves to the real Object builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-arrays, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-object-keys.ts: pass the real builtin.
export {};
let calls: number = 0;
const OwnObject: { keys(value: { item: number }): string[] } = {
  keys(value: { item: number }): string[] { calls++; return ["own", "key:" + value.item]; }
};

function check(Object: { keys(value: { item: number }): string[] }, n: number): void {
  calls = 0;
  const result = Object.keys({ item: n });
  assert.sameValue(result.length, 1);
  assert.sameValue(result[0], "item");
  assert.sameValue(result[1], undefined);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Object, n);
