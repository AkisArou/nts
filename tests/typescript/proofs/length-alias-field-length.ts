/*---
description: Assigning an array field's length through an owner alias invalidates its initial length.
features: [ts-proof-length, ts-route-alias, ts-arrays, ts-class, ts-class-fields, ts-functions, ts-iteration]
---*/
// Fact: the field's literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: another name for its owner sets length; node reads the assigned n.
class Holder {
  items: number[] = [10, 20, 30, 40];
}

function lengthThroughOwner(n: number): number {
  const holder = new Holder();
  const alias = holder;
  alias.items.length = n;
  return holder.items.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthThroughOwner(n), n);
}
