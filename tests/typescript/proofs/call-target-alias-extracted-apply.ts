/*---
description: An alias replaces an extracted method field before its apply invocation.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-class, ts-this, ts-this-parameter, ts-class-fields]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the declared function field changes from add to subtract; node applys that target.
class Worker {
  offset = 100;
  add(this: Worker, n: number): number { return this.offset + n; }
  subtract(this: Worker, n: number): number { return this.offset - n; }
}
function afterAlias(n: number): number {
  const receiver = new Worker();
  const holder: { action: (this: Worker, n: number) => number } = { action: receiver.add };
  const alias = holder;
  if (n > 0) alias.action = receiver.subtract;
  return holder.action.apply(receiver, [n]);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), n > 0 ? 100 - n : 100 + n);
}
