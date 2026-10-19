/*---
description: A generic factory takes a construct signature and returns an instance of the class it is given.
features: [ts-generics, ts-class, ts-construct-signatures]
---*/
class Dog {
  sound(): string {
    return "woof";
  }
}
class Cat {
  sound(): string {
    return "meow";
  }
}
function make<T>(ctor: new () => T, count: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(new ctor());
  return out;
}
const dogs = make(Dog, 2);
assert.sameValue(dogs.length, 2);
assert.sameValue(dogs[1] instanceof Dog, true);
assert.sameValue(make(Cat, 1)[0].sound(), "meow");
