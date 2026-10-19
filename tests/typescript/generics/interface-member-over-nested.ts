/*---
description: A generic interface instantiated at a nested generic types an object literal's members, which store and return its values.
features: [ts-generics, ts-interfaces, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
}
interface Store<T> {
  items: T[];
  add(item: T): number;
  pick(index: number): T;
}
const store: Store<Box<Box<number>>> = {
  items: [],
  add(item) {
    return this.items.push(item);
  },
  pick(index) {
    return this.items[index];
  },
};
const first: Box<Box<number>> = new Box(new Box(4));
const second: Box<Box<number>> = new Box(new Box(9));
assert.sameValue(store.add(first), 1);
assert.sameValue(store.add(second), 2);
assert.sameValue(store.pick(1), second);
const picked = store.pick(0);
assert.sameValue(picked.value.value, 4);
