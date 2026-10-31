/*---
description: An own class cast to MapConstructor preserves its constructor and get method.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-map-set, ts-tuples, ts-arrays, ts-instanceof]
---*/
// Route: a class is asserted to be Map; node returns the own stored value.
let calls = 0;
class OwnMap {
  readonly size: number = 1;
  readonly item: number;
  constructor(entries: [string, number][]) { calls++; this.item = entries[0][1] + 100; }
  get(key: string): number | undefined { return key === "item" ? this.item : undefined; }
}
function check(n: number): void {
  calls = 0;
  const Target = OwnMap as unknown as typeof Map;
  const entries: [string, number][] = [["item", n]];
  const value = new Target<string, number>(entries);
  assert.sameValue(calls, 1);
  assert.sameValue(value.size, 1);
  assert.sameValue(value.get("item"), n + 100);
  assert.sameValue(value.get("absent"), undefined);
  assert.sameValue(value instanceof OwnMap, true);
  assert.sameValue(value instanceof Map, false);
}
for (const n of [-3, 0, 1, 7]) check(n);
