/*---
description: A class declared in a function captures the call's locals, and each call makes a distinct class.
features: [ts-class, ts-closures]
---*/
function makeCounter(start: number) {
  return class Counter {
    value = start;
    bump(): number {
      return ++this.value;
    }
  };
}
const FromOne = makeCounter(1);
const FromTen = makeCounter(10);
assert.sameValue(new FromOne().bump(), 2);
assert.sameValue(new FromTen().bump(), 11);
assert.sameValue(FromOne === FromTen, false);
