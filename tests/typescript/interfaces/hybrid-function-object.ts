/*---
description: Object.assign onto a function builds a value with both a call signature and properties.
features: [ts-interfaces, ts-call-signatures]
---*/
interface Formatter {
  (value: number): string;
  digits: number;
}
const format: Formatter = Object.assign((value: number) => value.toFixed(format.digits), { digits: 2 });
assert.sameValue(format(3.14159), "3.14");
format.digits = 0;
assert.sameValue(format(2.5), "3");
