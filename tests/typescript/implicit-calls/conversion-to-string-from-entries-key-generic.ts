/*---
description: Object.fromEntries coerces an object entry key through a generic constrained to Hook and retains its write.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-to-string, ts-objects, ts-record]
---*/
// Route: Object.fromEntries key conversion through a generic constrained to Hook; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `key:${this.value}`; }
}
function convert<T extends Hook>(value: T, amount: number): Record<string, number> { return Object.fromEntries([[value, amount]]); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value, n * 2);
  assert.compareArray(Object.keys(result), [`key:${n}`]);
  assert.sameValue(result[`key:${n}`], n * 2);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`toString:${n}:${n + 17}`]);
}
