/*---
description: Control for subclass-map-super-arguments; construct Map directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-map-set, ts-tuples]
---*/
// Paired case: ../builtin-identity/subclass-map-super-arguments.ts.
// Change: Construct Map directly; adjust the subclass observations.
let constructions = 0;
class IdentityMap extends Map<string, number> {
  constructor(entries: [string, number][]) { super(entries); constructions++; }
}
function check(n: number): void {
  const entries: [string, number][] = [["left", n], ["right", n + 1]];
  const before = constructions;
  const result: Map<string, number> = new Map<string, number>(entries);
  assert.sameValue(constructions - before, 0);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("left"), n);
  assert.sameValue(result.get("right"), n + 1);
  assert.sameValue(result.get("missing"), undefined);
  assert.sameValue(result instanceof IdentityMap, false);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(new Map<string, number>(entries) instanceof IdentityMap, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
