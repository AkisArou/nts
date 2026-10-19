/*---
description: Class accessors and methods are non-enumerable prototype properties; fields are own and enumerable.
features: [ts-class, ts-accessors, ts-class-fields]
---*/
class Item {
  price = 3;
  get doubled(): number {
    return this.price * 2;
  }
  total(): number {
    return this.price;
  }
}
const item = new Item();
const keys: string[] = [];
for (const key in item) keys.push(key);
assert.sameValue(keys.join(","), "price");
assert.sameValue("doubled" in item, true);
assert.sameValue(Object.prototype.hasOwnProperty.call(item, "doubled"), false);
assert.sameValue(Object.getOwnPropertyDescriptor(Item.prototype, "total")?.enumerable, false);
