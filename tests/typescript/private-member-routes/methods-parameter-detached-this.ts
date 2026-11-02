/*---
description: A detached private method uses its call receiver and throws only when its body reads a missing private field.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-this-parameter, ts-this, ts-function-types, ts-inheritance, ts-tuples, ts-instanceof, ts-narrowing, ts-private-fields]
---*/
// CounterOwner methods cross an explicit-this function parameter; node records the supplied receiver, updates its slot, and rejects plain receivers at the field read.
const seen: object[] = [];
class CounterOwner {
  #value: number;
  constructor(value: number) { this.#value = value; }
  #add(step: number): number { seen.push(this); this.#value += step; return this.#value; }
  method(): (this: object, step: number) => number { return this.#add; }
  read(): number { return this.#value; }
}
class Child extends CounterOwner {}
function invoke(method: (this: object, step: number) => number, receiver: object): number { return method.call(receiver, 2); }
for (const value of [-0, 0, 3]) {
  const first = new CounterOwner(value), second = new Child(value + 3), plain = { value }, method = first.method();
  assert.sameValue(method, second.method());
  const entries: [object, boolean, number][] = [[second, true, value + 5], [plain, false, 0], [first, true, value + 2]];
  for (const [receiver, valid, expected] of entries) {
    seen.length = 0;
    if (valid) assert.sameValue(invoke(method, receiver), expected); else assert.throws(TypeError, () => invoke(method, receiver));
    assert.compareArray(seen, [receiver]);
    if (receiver instanceof CounterOwner) assert.sameValue(receiver.read(), expected);
  }
  assert.sameValue(plain.value, value); assert.sameValue(first.read(), value + 2); assert.sameValue(second.read(), value + 5);
}
