/*---
description: Comparing two objects with `<` converts each with the number hint, left operand first.
features: [ts-conversions, ts-to-primitive, ts-class]
---*/
const order: string[] = [];
class Version {
  constructor(private label: string, private rank: number) {}
  valueOf(): number {
    order.push(this.label);
    return this.rank;
  }
}
const older = new Version("old", 1);
const newer = new Version("new", 2);
assert.sameValue(older < newer, true);
assert.sameValue(newer <= older, false);
assert.sameValue(older >= older, true);
assert.compareArray(order, ["old", "new", "new", "old", "old", "old"]);
