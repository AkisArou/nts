/*---
description: Control for reflection-construct-namesake-class; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof, ts-modules]
flags: [module]
---*/
// Paired case: ../builtin-identity/reflection-construct-namesake-class.ts.
// Control: Reflect.construct(target, [n]) becomes new target(n).
export {};
let calls = 0;
class Map {
  readonly value: number;
  constructor(n: number) { calls++; this.value = n + 100; }
}
function build(target: new (n: number) => Map, n: number): Map {
  const result: Map = new target(n);
  return result;
}
for (const n of [-3, 0, 7]) {
  calls = 0;
  const result = build(Map, n);
  assert.sameValue(calls, 1);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.value, n + 100);
}
