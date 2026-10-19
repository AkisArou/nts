/*---
description: A number field that holds integers keeps fractions too, once an operation produces one.
features: [ts-numbers, ts-class]
---*/
class Meter {
  reading = 0;
  add(amount: number): void {
    this.reading += amount;
  }
}
const meter = new Meter();
meter.add(3);
assert.sameValue(meter.reading, 3);
meter.add(0.25);
assert.sameValue(meter.reading, 3.25);
meter.reading = meter.reading * 4;
assert.sameValue(meter.reading, 13);
meter.reading /= 2;
assert.sameValue(meter.reading, 6.5);
