/*---
description: Object.fromEntries coerces an object entry key through a union of string and Hook and retains its write.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-to-string, ts-objects, ts-record]
---*/
// Route: Object.fromEntries key conversion through a union of string and Hook; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `key:${this.value}`; }
}
function convert(value: string | Hook, amount: number): Record<string, number> { return Object.fromEntries([[value, amount]]); }
for (const n of [-2, 0, 3]) {
  const inputs: (string | Hook)[] = [`key:${n}`, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value, n * 2);
    assert.compareArray(Object.keys(result), [`key:${n}`]);
    assert.sameValue(result[`key:${n}`], n * 2);
    const called = typeof value === "object";
    assert.sameValue(state, called ? n + 17 : 10);
    assert.compareArray(log, called ? [`toString:${n}:${n + 17}`] : []);
  }
}
