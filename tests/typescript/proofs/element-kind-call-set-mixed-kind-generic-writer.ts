/*---
description: A generic writer adds a string through a wider view while the original reader still takes Set<number>.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-generics, ts-unknown, ts-strings, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: a normal Set<number> to Set<unknown> assignment lets a generic callee insert a string.
function read(items: Set<number>): unknown {
  let last: unknown = 0;
  for (const value of items) last = value;
  return last;
}
function insert<T>(items: Set<T>, value: T): void { items.add(value); }
function observe(n: number): unknown {
  const items = new Set<number>([1, 2]);
  const writer: Set<unknown> = items;
  if (n > 0) insert(writer, "item:" + n);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "string" : "number");
  assert.sameValue(result, n > 0 ? "item:" + n : 2);
}
