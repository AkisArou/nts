/*---
description: A setter that rejects a value throws, and the value it guards is unchanged.
features: [ts-class, ts-accessors, ts-errors]
---*/
class Percent {
  #value = 0;
  get value(): number {
    return this.#value;
  }
  set value(next: number) {
    if (next < 0 || next > 100) throw new RangeError("out of range");
    this.#value = next;
  }
}
const percent = new Percent();
percent.value = 40;
assert.throws(RangeError, () => {
  percent.value = 140;
});
assert.sameValue(percent.value, 40);
