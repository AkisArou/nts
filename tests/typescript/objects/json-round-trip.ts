/*---
description: JSON.stringify of a typed object keeps its own data properties; parsing back gives a plain object of the same shape.
features: [ts-objects, ts-class]
---*/
class Item {
  constructor(public label: string, public price: number, public tags: string[] = []) {}
  priceWithTax(): number {
    return this.price * 1.25;
  }
}
const text = JSON.stringify(new Item("pen", 4, ["office"]));
assert.sameValue(text, '{"label":"pen","price":4,"tags":["office"]}');
const back = JSON.parse(text) as { label: string; price: number; tags: string[] };
assert.sameValue(back.price + back.tags.length, 5);
assert.sameValue(back instanceof Item, false);
