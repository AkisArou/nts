/*---
description: Control for reflection-global-map-shadowed-local; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-map-set, ts-instanceof]
---*/
// Paired case: ../builtin-identity/reflection-global-map-shadowed-local.ts.
// Control: globalThis.Map becomes BuiltinMap.
const BuiltinMap: MapConstructor = Map;
let calls = 0;
function check(n: number): void {
  class Map {
    readonly size: number;
    constructor(value: number) { calls++; this.size = value + 100; }
  }
  const target: MapConstructor = BuiltinMap;
  const result = new target<string, number>([["item", n]]);
  assert.sameValue(result instanceof BuiltinMap, true);
  assert.sameValue(result instanceof Map, false);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
  assert.sameValue(calls, 0);
}
for (const n of [-3, 0, 7]) check(n);
