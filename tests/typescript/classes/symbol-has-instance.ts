/*---
description: A static Symbol.hasInstance method decides what instanceof answers for a class.
features: [ts-class, ts-static, ts-symbols, ts-instanceof]
---*/
class Even {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number" && value % 2 === 0;
  }
}
const four: unknown = 4;
const three: unknown = 3;
assert.sameValue(four instanceof Even, true);
assert.sameValue(three instanceof Even, false);
