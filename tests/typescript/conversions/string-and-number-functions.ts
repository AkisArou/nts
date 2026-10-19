/*---
description: String() converts with the string hint (toString first) and Number() with the number hint (valueOf first).
features: [ts-conversions, ts-to-primitive, ts-to-string, ts-class]
---*/
class Both {
  valueOf(): number {
    return 7;
  }
  toString(): string {
    return "seven";
  }
}
const both = new Both();
assert.sameValue(String(both), "seven");
assert.sameValue(Number(both), 7);
assert.sameValue(`${both}`, "seven");
assert.sameValue(both + "", "7");
assert.sameValue([both, both].join("/"), "seven/seven");
