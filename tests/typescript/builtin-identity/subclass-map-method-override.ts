/*---
description: A Map subclass dispatches an override through a base-typed value.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-map-set, ts-tuples]
---*/
// Route: a typed Map subclass dispatches an override through a base-typed value; node preserves the subclass and its behavior.
class IdentityMap extends Map<string, number> {
  override get(key: string): number | undefined {
    const value = super.get(key);
    return value === undefined ? undefined : value + 100;
  }
}
function check(n: number): void {
  const entries: [string, number][] = [["left", n], ["right", n + 1]];
  const result: Map<string, number> = new IdentityMap(entries);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("left"), n + 100);
  assert.sameValue(result.get("right"), n + 101);
  assert.sameValue(result.get("missing"), undefined);
  assert.sameValue(result instanceof IdentityMap, true);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(new Map<string, number>(entries) instanceof IdentityMap, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
