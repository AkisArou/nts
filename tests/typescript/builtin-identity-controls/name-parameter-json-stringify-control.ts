/*---
description: Control for name-parameter-json-stringify; the target resolves to the real JSON builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-json-stringify.ts: pass the real builtin.
export {};
let calls: number = 0;
const OwnJSON: { stringify(value: { item: number }): string } = {
  stringify(value: { item: number }): string { calls++; return "own:" + value.item; }
};

function check(JSON: { stringify(value: { item: number }): string | undefined }, n: number): void {
  calls = 0;
  const result = JSON.stringify({ item: n });
  assert.sameValue(result, '{"item":' + n + '}');
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(JSON, n);
