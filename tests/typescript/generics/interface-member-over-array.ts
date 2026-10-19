/*---
description: A generic interface instantiated at an array type types an object literal's members, which store and return its values.
features: [ts-generics, ts-interfaces]
---*/
interface Store<T> {
  items: T[];
  add(item: T): number;
  pick(index: number): T;
}
const store: Store<number[]> = {
  items: [],
  add(item) {
    return this.items.push(item);
  },
  pick(index) {
    return this.items[index];
  },
};
const first: number[] = [1, 2, 3];
const second: number[] = [10];
assert.sameValue(store.add(first), 1);
assert.sameValue(store.add(second), 2);
assert.sameValue(store.pick(1), second);
const picked = store.pick(0);
assert.sameValue(picked.length + picked[0], 4);
