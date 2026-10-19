/*---
description: A generic interface instantiated at a function type types an object literal's members, which store and return its values.
features: [ts-generics, ts-interfaces, ts-function-types]
---*/
interface Store<T> {
  items: T[];
  add(item: T): number;
  pick(index: number): T;
}
const store: Store<(n: number) => number> = {
  items: [],
  add(item) {
    return this.items.push(item);
  },
  pick(index) {
    return this.items[index];
  },
};
const first: (n: number) => number = (n: number) => n + 1;
const second: (n: number) => number = (n: number) => n * 3;
assert.sameValue(store.add(first), 1);
assert.sameValue(store.add(second), 2);
assert.sameValue(store.pick(1), second);
const picked = store.pick(0);
assert.sameValue(picked(4), 5);
