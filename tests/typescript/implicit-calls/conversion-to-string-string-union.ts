/*---
description: String conversion invokes the declared conversion hook through a union of string and Hook.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-to-string]
---*/
// Route: String conversion through a union of string and Hook; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `text:${this.value}`; }
}
function convert(value: string | Hook): string { return String(value); }
for (const n of [-2, 0, 3]) {
  const inputs: (string | Hook)[] = [`text:${n}`, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value);
    const called = typeof value === "object";
    assert.sameValue(result, `text:${n}`);
    assert.sameValue(state, called ? n + 17 : 10);
    assert.compareArray(log, called ? [`toString:${n}:${n + 17}`] : []);
  }
}
