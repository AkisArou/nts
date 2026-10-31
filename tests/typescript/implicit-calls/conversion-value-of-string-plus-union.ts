/*---
description: String addition with the default hint invokes the declared conversion hook through a union of number and Hook.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions]
---*/
// Route: string addition with the default hint through a union of number and Hook; node preserves every hook call, its effect and the result.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += this.value + 7; log.push(`valueOf:${this.value}:${state}`); return this.value; }
}
function convert(value: number | Hook): string { return value + "!"; }
for (const n of [-2, 0, 3]) {
  const inputs: (number | Hook)[] = [n, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value);
    const called = typeof value === "object";
    assert.sameValue(result, `${n}!`);
    assert.sameValue(state, called ? n + 17 : 10);
    assert.compareArray(log, called ? [`valueOf:${n}:${n + 17}`] : []);
  }
}
