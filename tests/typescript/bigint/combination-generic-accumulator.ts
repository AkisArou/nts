/*---
description: A generic accumulator class over number or bigint, given its zero and its addition, used at both.
features: [ts-bigint, ts-generics, ts-generic-constraints, ts-class, ts-unions]
---*/
class Accumulator<T extends number | bigint> {
  private total: T;
  constructor(zero: T, private add: (a: T, b: T) => T) {
    this.total = zero;
  }
  push(value: T): this {
    this.total = this.add(this.total, value);
    return this;
  }
  value(): T {
    return this.total;
  }
}
const floats = new Accumulator<number>(0, (a, b) => a + b).push(0.5).push(0.25);
const exact = new Accumulator<bigint>(0n, (a, b) => a + b).push(2n ** 60n).push(1n);
assert.sameValue(floats.value(), 0.75);
assert.sameValue(exact.value(), 1152921504606846977n);
