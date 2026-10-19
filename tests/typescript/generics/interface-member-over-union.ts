/*---
description: A generic interface instantiated at a union types an object literal's members, which store and return its values.
features: [ts-generics, ts-interfaces, ts-unions]
---*/
interface Store<T> {
  items: T[];
  add(item: T): number;
  pick(index: number): T;
}
const store: Store<number | string> = {
  items: [],
  add(item) {
    return this.items.push(item);
  },
  pick(index) {
    return this.items[index];
  },
};
const first: number | string = 7;
const second: number | string = "seven";
assert.sameValue(store.add(first), 1);
assert.sameValue(store.add(second), 2);
assert.sameValue(store.pick(1), second);
const picked = store.pick(0);
assert.sameValue(typeof picked === "number" ? picked + 1 : picked.length, 8);
