/*---
description: Shifting an alias of an array field invalidates a bound proved through that field.
features: [ts-proof-bounds, ts-route-alias, ts-arrays, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: a literal field and its length guard prove i.
// The local alias shifts it; node sees the shifted value or undefined at index 3.
class Holder {
  items: number[] = [10, 20, 30, 40];
}

function readFieldAfterAlias(i: number, remove: boolean): number | undefined {
  const holder = new Holder();
  const alias = holder.items;
  if (i >= 0 && i < holder.items.length) {
    if (remove) alias.shift();
    return holder.items[i];
  }
  return -1;
}

for (const i of [0, 1, 3, 4, 7, -1]) {
  assert.sameValue(readFieldAfterAlias(i, false), i >= 0 && i < 4 ? (i + 1) * 10 : -1);
  const shifted = i >= 0 && i < 3 ? (i + 2) * 10 : i === 3 ? undefined : -1;
  assert.sameValue(readFieldAfterAlias(i, true), shifted);
}
