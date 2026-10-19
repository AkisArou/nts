/*---
description: `==` between an object and a number converts the object with the default hint, through valueOf.
features: [ts-conversions, ts-to-primitive, ts-class]
---*/
class Answer {
  valueOf(): number {
    return 42;
  }
  toString(): string {
    return "forty-two";
  }
}
const answer = new Answer();
assert.sameValue(answer == 42, true);
assert.sameValue(answer === (42 as unknown), false);
assert.sameValue(answer != 41, true);
