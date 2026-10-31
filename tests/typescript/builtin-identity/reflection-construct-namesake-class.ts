/*---
description: Reflect.construct of an own typed Map class runs that class, including its constructor side effect.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof, ts-modules]
flags: [module]
---*/
// Route: Reflect.construct of a typed namesake constructor; node follows the actual value.
export {};
let calls = 0;
class Map {
  readonly value: number;
  constructor(n: number) { calls++; this.value = n + 100; }
}
function build(target: new (n: number) => Map, n: number): Map {
  const result: Map = Reflect.construct(target, [n]);
  return result;
}
for (const n of [-3, 0, 7]) {
  calls = 0;
  const result = build(Map, n);
  assert.sameValue(calls, 1);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.value, n + 100);
}
