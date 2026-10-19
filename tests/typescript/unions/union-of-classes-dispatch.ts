/*---
description: A method common to every member of a union of classes is called without narrowing and dispatches per object.
features: [ts-unions, ts-class]
---*/
class Meters {
  constructor(private n: number) {}
  toMm(): number {
    return this.n * 1000;
  }
}
class Inches {
  constructor(private n: number) {}
  toMm(): number {
    return this.n * 25.4;
  }
}
const lengths: (Meters | Inches)[] = [new Meters(1), new Inches(10), new Meters(0.5)];
let total = 0;
for (const length of lengths) total += length.toMm();
assert.sameValue(total, 1754);
