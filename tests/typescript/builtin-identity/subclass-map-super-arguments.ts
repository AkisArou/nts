/*---
description: A Map subclass forwards typed arguments through its own constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-map-set, ts-tuples]
---*/
// Route: a typed Map subclass forwards typed arguments through its own constructor; node preserves the subclass and its behavior.
let constructions = 0;
class IdentityMap extends Map<string, number> {
  constructor(entries: [string, number][]) { super(entries); constructions++; }
}
function check(n: number): void {
  const entries: [string, number][] = [["left", n], ["right", n + 1]];
  const before = constructions;
  const result: Map<string, number> = new IdentityMap(entries);
  assert.sameValue(constructions - before, 1);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("left"), n);
  assert.sameValue(result.get("right"), n + 1);
  assert.sameValue(result.get("missing"), undefined);
  assert.sameValue(result instanceof IdentityMap, true);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(new Map<string, number>(entries) instanceof IdentityMap, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
