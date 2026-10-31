/*---
description: globalThis.Map keeps builtin identity when a typed local class is also named Map.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-map-set, ts-instanceof]
---*/
// Route: globalThis.Map beside a typed local namesake; node follows the actual value.
const BuiltinMap: MapConstructor = Map;
let calls = 0;
function check(n: number): void {
  class Map {
    readonly size: number;
    constructor(value: number) { calls++; this.size = value + 100; }
  }
  const target: MapConstructor = globalThis.Map;
  const result = new target<string, number>([["item", n]]);
  assert.sameValue(result instanceof BuiltinMap, true);
  assert.sameValue(result instanceof Map, false);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
  assert.sameValue(calls, 0);
}
for (const n of [-3, 0, 7]) check(n);
