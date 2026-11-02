/*---
description: A detached private method uses its call receiver and throws only when its body reads a missing private field. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-this-parameter, ts-this, ts-function-types, ts-inheritance, ts-tuples, ts-instanceof, ts-narrowing, ts-map-set]
---*/
// CounterOwner methods cross an explicit-this function parameter; node records the supplied receiver, updates its slot, and rejects plain receivers at the field read. The control stores each private name in its own checked Map.
const seen: object[] = [], valuesByOwner = new Map<object, number>(), methodsByOwner = new Map<object, (this: object, step: number) => number>();
function privateAdd(this: object, step: number): number {
  seen.push(this); if (!valuesByOwner.has(this)) throw new TypeError(); const value = valuesByOwner.get(this); if (value === undefined) throw new Error("missing value");
  if (!valuesByOwner.has(this)) throw new TypeError(); valuesByOwner.set(this, value + step);
  if (!valuesByOwner.has(this)) throw new TypeError(); const result = valuesByOwner.get(this); if (result === undefined) throw new Error("missing value"); return result;
}
class CounterOwner {
  constructor(value: number) { valuesByOwner.set(this, value); methodsByOwner.set(this, privateAdd); }
  method(): (this: object, step: number) => number { if (!methodsByOwner.has(this)) throw new TypeError(); const method = methodsByOwner.get(this); if (method === undefined) throw new Error("missing method"); return method; }
  read(): number { if (!valuesByOwner.has(this)) throw new TypeError(); const value = valuesByOwner.get(this); if (value === undefined) throw new Error("missing value"); return value; }
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
