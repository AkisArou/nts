/*---
description: Control for conversion-value-of-unary-plus-union; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions]
---*/
// Control: ../implicit-calls/conversion-value-of-unary-plus-union.ts; only the implicit hook route is made explicit.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += this.value + 7; log.push(`valueOf:${this.value}:${state}`); return this.value; }
}
function convert(value: number | Hook): number { return typeof value === "number" ? value : value.valueOf(); }
for (const n of [-2, 0, 3]) {
  const inputs: (number | Hook)[] = [n, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value);
    const called = typeof value === "object";
    assert.sameValue(result, n);
    assert.sameValue(state, called ? n + 17 : 10);
    assert.compareArray(log, called ? [`valueOf:${n}:${n + 17}`] : []);
  }
}
