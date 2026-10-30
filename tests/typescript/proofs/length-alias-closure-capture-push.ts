/*---
description: A closure-held alias grows the original class field allocation.
features: [ts-proof-length, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-class, ts-class-fields]
---*/
// Fact: the literal field has length 4 (docs/foundations/objects.md, Arrays).
// Route: a closure holds a second name for it; node reads 5 after its push.
class Holder { items: number[] = [10, 20, 30, 40]; }
function lengthThroughCapturedAlias(n: number): number {
  const holder = new Holder();
  const alias = holder.items;
  function append(): void {
    if (n > 0) alias.push(n);
  }
  if (holder.items.length !== 4) return -1;
  append();
  return holder.items.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthThroughCapturedAlias(n), n > 0 ? 5 : 4);
}
