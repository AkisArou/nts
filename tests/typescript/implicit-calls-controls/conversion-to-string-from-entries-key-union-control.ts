/*---
description: Control for conversion-to-string-from-entries-key-union; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-to-string, ts-objects, ts-record]
---*/
// Control: ../implicit-calls/conversion-to-string-from-entries-key-union.ts; only the implicit hook route is made explicit.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `key:${this.value}`; }
}
function convert(value: string | Hook, amount: number): Record<string, number> { return Object.fromEntries([[value.toString(), amount]]); }
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
