/*---
description: Unary plus converts an object with the number hint, so valueOf answers before toString.
features: [ts-conversions, ts-to-primitive, ts-class]
---*/
const calls: string[] = [];
class Celsius {
  constructor(private degrees: number) {}
  valueOf(): number {
    calls.push("valueOf");
    return this.degrees;
  }
  toString(): string {
    calls.push("toString");
    return `${this.degrees}C`;
  }
}
assert.sameValue(+new Celsius(21), 21);
assert.compareArray(calls, ["valueOf"]);
