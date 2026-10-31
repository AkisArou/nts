/*---
description: String conversion with the string hint invokes the declared conversion hook through a declared Hook interface.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-symbols]
---*/
// Route: String conversion with the string hint through a declared Hook interface; node preserves every hook call, its effect and the result.
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
function convert(value: Hook): string { return String(value); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, `text:${n}`);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`primitive:string:${n}:${n + 17}`]);
}
