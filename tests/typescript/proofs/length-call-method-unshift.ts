/*---
description: A method unshift invalidates the known length of an array field.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-class, ts-class-fields]
---*/
// Fact: the literal field has length 3 (docs/foundations/objects.md, Arrays).
// Route: a method grows that field; node reads 4, or unchanged 3.
class Holder {
  items: number[] = [10, 20, 30];
  grow(n: number): void {
    if (n > 0) this.items.unshift(n);
  }
}
function lengthAfterMethod(n: number): number {
  const holder = new Holder();
  holder.grow(n);
  return holder.items.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterMethod(n), n > 0 ? 4 : 3);
}
