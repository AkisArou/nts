/*---
description: Control for cast-map-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-map-set, ts-tuples, ts-arrays, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-map-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnMap {
  readonly size: number = 1;
  readonly item: number;
  constructor(entries: [string, number][]) { calls++; this.item = entries[0][1] + 100; }
  get(key: string): number | undefined { return key === "item" ? this.item : undefined; }
}
function check(n: number): void {
  calls = 0;
  const Target = Map;
  const entries: [string, number][] = [["item", n]];
  const value = new Target<string, number>(entries);
  assert.sameValue(calls, 0);
  assert.sameValue(value.size, 1);
  assert.sameValue(value.get("item"), n);
  assert.sameValue(value.get("absent"), undefined);
  assert.sameValue(value instanceof OwnMap, false);
  assert.sameValue(value instanceof Map, true);
}
for (const n of [-3, 0, 1, 7]) check(n);
