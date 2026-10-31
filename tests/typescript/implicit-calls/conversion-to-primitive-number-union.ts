/*---
description: Unary plus with the number hint invokes the declared conversion hook through a union of number and Hook.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-symbols]
---*/
// Route: unary plus with the number hint through a union of number and Hook; node preserves every hook call, its effect and the result.
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
function convert(value: number | Hook): number { return +value; }
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
