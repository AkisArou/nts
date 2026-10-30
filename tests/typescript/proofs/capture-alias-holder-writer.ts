/*---
description: A holder alias calls the writer of the binding returned by the original reader.
features: [ts-proof-capture, ts-route-alias, ts-functions, ts-iteration, ts-closures, ts-objects, ts-function-types]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the alias invokes a stored writer of value itself; node reads its new binding value.
function afterAlias(n: number): number {
  let value = 0;
  const holder = {
    read: (): number => value,
    write: (next: number): void => { value = next; }
  };
  const alias = holder;
  alias.write(n);
  return holder.read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterAlias(n), n);
