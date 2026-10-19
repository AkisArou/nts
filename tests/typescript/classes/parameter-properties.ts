/*---
description: Constructor parameters with a modifier become fields.
features: [ts-parameter-properties, ts-class]
---*/
class Pair {
  constructor(public left: number, private right: number) {}
  sum(): number {
    return this.left + this.right;
  }
}
const pair = new Pair(2, 3);
assert.sameValue(pair.left, 2);
assert.sameValue(pair.sum(), 5);
