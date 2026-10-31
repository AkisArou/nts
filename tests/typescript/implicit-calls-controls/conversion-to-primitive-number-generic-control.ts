/*---
description: Control for conversion-to-primitive-number-generic; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-symbols]
---*/
// Control: ../implicit-calls/conversion-to-primitive-number-generic.ts; only the implicit hook route is made explicit.
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
function convert<T extends Hook>(value: T): number { return +value[Symbol.toPrimitive]("number"); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, n);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`primitive:number:${n}:${n + 17}`]);
}
