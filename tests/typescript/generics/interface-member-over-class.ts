/*---
description: A generic interface instantiated at a class types an object literal's members, which store and return its values.
features: [ts-generics, ts-interfaces, ts-class]
---*/
class Coin {
  constructor(public cents: number) {}
}
interface Store<T> {
  items: T[];
  add(item: T): number;
  pick(index: number): T;
}
const store: Store<Coin> = {
  items: [],
  add(item) {
    return this.items.push(item);
  },
  pick(index) {
    return this.items[index];
  },
};
const first: Coin = new Coin(5);
const second: Coin = new Coin(25);
assert.sameValue(store.add(first), 1);
assert.sameValue(store.add(second), 2);
assert.sameValue(store.pick(1), second);
const picked = store.pick(0);
assert.sameValue(picked.cents, 5);
