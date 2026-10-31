/*---
description: A joined target is bound to a string payload inside a generic function.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-generics, ts-strings]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the branch changes the target before a generic bind; node uses its selected string-length multiplier.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function length(this: Receiver, text: string): number { return this.offset + text.length; }
function doubleLength(this: Receiver, text: string): number { return this.offset + 2 * text.length; }
function bindValue<T>(target: (this: Receiver, value: T) => number,
                      receiver: Receiver, value: T): () => number {
  return target.bind(receiver, value);
}
function afterChoice(n: number): number {
  const receiver = new Receiver(100 + n);
  const text = "abcdefg".slice(0, n);
  let target = length;
  if (n > 1) target = doubleLength;
  return bindValue(target, receiver, text)();
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(afterChoice(n), n > 1 ? 100 + 3 * n : 100 + 2 * n);
}
