/*---
description: Control for subclass-map-implicit-constructor; construct Map directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-map-set, ts-tuples]
---*/
// Paired case: ../builtin-identity/subclass-map-implicit-constructor.ts.
// Change: Construct Map directly; adjust the subclass observations.
class IdentityMap extends Map<string, number> {}
function check(n: number): void {
  const entries: [string, number][] = [["left", n], ["right", n + 1]];
  const result: Map<string, number> = new Map<string, number>(entries);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("left"), n);
  assert.sameValue(result.get("right"), n + 1);
  assert.sameValue(result.get("missing"), undefined);
  assert.sameValue(result instanceof IdentityMap, false);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(new Map<string, number>(entries) instanceof IdentityMap, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
