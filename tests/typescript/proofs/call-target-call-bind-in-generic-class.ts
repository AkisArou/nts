/*---
description: A called writer replaces the string callback bound by a generic class method.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-generics, ts-strings]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the intervening call changes the target field; node binds the replacement inside Binder<T>.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function length(this: Receiver, text: string): number { return this.offset + text.length; }
function doubleLength(this: Receiver, text: string): number { return this.offset + 2 * text.length; }
class Binder<T> {
  receiver: Receiver;
  target: (this: Receiver, value: T) => number;
  value: T;
  constructor(receiver: Receiver, target: (this: Receiver, value: T) => number, value: T) {
    this.receiver = receiver;
    this.target = target;
    this.value = value;
  }
  run(): number { return this.target.bind(this.receiver, this.value)(); }
}
function replace(binder: Binder<string>, n: number): void {
  if (n > 1) binder.target = doubleLength;
}
function afterCall(n: number): number {
  const binder = new Binder(new Receiver(100 + n), length, "abcdefg".slice(0, n));
  replace(binder, n);
  return binder.run();
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(afterCall(n), n > 1 ? 100 + 3 * n : 100 + 2 * n);
}
