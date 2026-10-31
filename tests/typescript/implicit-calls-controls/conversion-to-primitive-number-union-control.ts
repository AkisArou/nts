/*---
description: Control for conversion-to-primitive-number-union; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-symbols]
---*/
// Control: ../implicit-calls/conversion-to-primitive-number-union.ts; only the implicit hook route is made explicit.
interface Hook { [Symbol.toPrimitive](hint: "number" | "string" | "default"): number | string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  [Symbol.toPrimitive](hint: "number" | "string" | "default"): number | string {
    state += this.value + 7; log.push(`primitive:${hint}:${this.value}:${state}`);
    return hint === "string" ? `text:${this.value}` : this.value;
  }
}
function convert(value: number | Hook): number { return +(typeof value === "number" ? value : value[Symbol.toPrimitive]("number")); }
for (const n of [-2, 0, 3]) {
  const inputs: (number | Hook)[] = [n, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value);
    const called = typeof value === "object";
    assert.sameValue(result, n);
    assert.sameValue(state, called ? n + 17 : 10);
    assert.compareArray(log, called ? [`primitive:number:${n}:${n + 17}`] : []);
  }
}
