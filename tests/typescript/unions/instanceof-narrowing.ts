/*---
description: instanceof narrows a union of classes to the member whose methods are called.
features: [ts-unions, ts-narrowing, ts-instanceof, ts-class]
---*/
class Cat {
  purr(): string {
    return "purr";
  }
}
class Dog {
  bark(): string {
    return "woof";
  }
}
function voice(pet: Cat | Dog): string {
  if (pet instanceof Cat) return pet.purr();
  return pet.bark();
}
assert.sameValue(voice(new Cat()), "purr");
assert.sameValue(voice(new Dog()), "woof");
