/*---
description: A returned target is bound inside a generic function without losing its implementation or numeric payload.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-generics]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: choose returns a replacement before the generic function binds it; node preserves target and payload.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function total(this: Receiver, value: number, extra: number): number {
  return this.offset + value + extra;
}
function weighted(this: Receiver, value: number, extra: number): number {
  return this.offset + 2 * value + 3 * extra;
}
function bindValue<T>(target: (this: Receiver, value: T, extra: number) => number,
                      receiver: Receiver, value: T): (extra: number) => number {
  return target.bind(receiver, value);
}
function choose(target: typeof total, n: number): typeof total {
  return n > 0 ? weighted : target;
}
function afterCall(n: number): number {
  const receiver = new Receiver(100 + n);
  let target = total;
  target = choose(target, n);
  return bindValue(target, receiver, n)(4);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), n > 0 ? 112 + 3 * n : 104 + 2 * n);
}
