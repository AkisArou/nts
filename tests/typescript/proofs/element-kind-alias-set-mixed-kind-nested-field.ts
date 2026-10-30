/*---
description: An object stored through a nested wider Set alias is retained by the original numeric reader.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-narrowing, ts-typeof-operator, ts-instanceof]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: an array-held object field exposes the original Set as Set<unknown> and stores a Packet instance.
class Packet {
  code: number;
  constructor(code: number) { this.code = code; }
}

function read(items: Set<number>): unknown {
  let last: unknown = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): unknown {
  const items = new Set<number>([1, 2]);
  const holders: { active: Set<unknown> }[] = [{ active: items }];
  const alias = holders[0].active;
  if (n > 0) alias.add(new Packet(n));
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "object" : "number");
  if (result instanceof Packet) assert.sameValue(result.code, n);
  else assert.sameValue(result, 2);
}
