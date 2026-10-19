/*---
description: A generic class holds a value of its parameter, at two instantiations.
features: [ts-generics, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}
assert.sameValue(new Box(2).map((n) => n * 10).value, 20);
assert.sameValue(new Box("x").map((s) => s.length).value, 1);
