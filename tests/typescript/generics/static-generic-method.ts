/*---
description: A static generic factory on a generic class builds instances at the types it is called with.
features: [ts-generics, ts-class, ts-static]
---*/
class Wrapper<T> {
  private constructor(readonly value: T) {}
  static of<U>(value: U): Wrapper<U> {
    return new Wrapper(value);
  }
  map<U>(f: (value: T) => U): Wrapper<U> {
    return Wrapper.of(f(this.value));
  }
}
const wrapped = Wrapper.of("hello").map((s) => s.length);
assert.sameValue(wrapped.value, 5);
assert.sameValue(Wrapper.of(true).map((b) => (b ? 1 : 0)).value, 1);
