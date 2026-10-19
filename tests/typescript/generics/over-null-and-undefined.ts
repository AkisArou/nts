/*---
description: A generic class instantiated at undefined, at null and at an optional type holds those values as given.
features: [ts-generics, ts-class, ts-null-undefined]
---*/
class Slot<T> {
  constructor(public value: T) {}
  isSet(): boolean {
    return this.value !== undefined && this.value !== null;
  }
}
const empty = new Slot<undefined>(undefined);
const cleared = new Slot<null>(null);
const maybe = new Slot<number | undefined>(undefined);
assert.sameValue(empty.value, undefined);
assert.sameValue(cleared.value, null);
assert.sameValue(maybe.isSet(), false);
maybe.value = 0;
assert.sameValue(maybe.isSet(), true);
assert.sameValue(cleared.isSet(), false);
