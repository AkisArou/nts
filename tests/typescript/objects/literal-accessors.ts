/*---
description: Getters and setters in an object literal compute and validate on access.
features: [ts-objects, ts-accessors]
---*/
const temperature = {
  celsius: 0,
  get fahrenheit(): number {
    return this.celsius * 9 / 5 + 32;
  },
  set fahrenheit(value: number) {
    this.celsius = (value - 32) * 5 / 9;
  },
};
assert.sameValue(temperature.fahrenheit, 32);
temperature.fahrenheit = 212;
assert.sameValue(temperature.celsius, 100);
assert.sameValue(Object.keys(temperature).join(","), "celsius,fahrenheit");
