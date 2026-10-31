/*---
description: An alias changes the function field that a generic class method binds.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-generics]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: an owner alias replaces the target before the generic class binds its saved numeric payload.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function total(this: Receiver, value: number, extra: number): number { return this.offset + value + extra; }
function weighted(this: Receiver, value: number, extra: number): number { return this.offset + 2 * value + 3 * extra; }
class Binder<T> {
  receiver: Receiver;
  target: (this: Receiver, value: T, extra: number) => number;
  value: T;
  constructor(receiver: Receiver, target: (this: Receiver, value: T, extra: number) => number, value: T) {
    this.receiver = receiver;
    this.target = target;
    this.value = value;
  }
  run(extra: number): number { return this.target.bind(this.receiver, this.value)(extra); }
}
function afterAlias(n: number): number {
  const binder = new Binder(new Receiver(100 + n), total, n);
  const alias = binder;
  if (n > 0) alias.target = weighted;
  return binder.run(4);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), n > 0 ? 112 + 3 * n : 104 + 2 * n);
}
