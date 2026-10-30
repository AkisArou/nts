/*---
description: Template interpolation observes Set contents before and after a toString hook adds a string.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-strings, ts-spread, ts-template-literals, ts-conversions, ts-to-primitive, ts-to-string, ts-objects, ts-closures, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the middle interpolation invokes toString, which inserts a string into the initially numeric Set.
function read(items: Set<number | string>): number | string {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number) {
  const items = new Set<number | string>([1, 2]);
  const gate = {
    toString(): string { if (n > 0) items.add("item:" + n); return "step"; }
  };
  const rendered = `${read(items)}:${gate}:${read(items)}`;
  return { rendered, value: read(items) };
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result.rendered, n > 0 ? "2:step:item:" + n : "2:step:2");
  assert.sameValue(typeof result.value, n > 0 ? "string" : "number");
  assert.sameValue(result.value, n > 0 ? "item:" + n : 2);
}
