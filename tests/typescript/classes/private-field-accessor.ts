/*---
description: A getter reads a private field; a setter writes it.
features: [ts-class, ts-private-fields, ts-accessors]
---*/
class Box {
  #value = 1;
  get value(): number {
    return this.#value;
  }
  set value(next: number) {
    this.#value = next * 2;
  }
}
const box = new Box();
box.value = 5;
assert.sameValue(box.value, 10);
