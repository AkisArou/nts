/*---
description: Valueof returning an object falls back to tostring through a union of number and Hook, preserving both effects.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-to-string, ts-objects]
---*/
// Route: number-hint fallback through a union of number and Hook; node preserves every hook call, its effect and the result.
interface Hook { valueOf(): object; toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): object { state += 1; log.push(`valueOf:${this.value}:${state}`); return this; }
  toString(): string { state += 10; log.push(`toString:${this.value}:${state}`); return String(this.value); }
}
function convert(value: number | Hook): number { return Number(value); }
for (const n of [-2, 0, 3]) {
  const inputs: (number | Hook)[] = [n, new Box(n)];
  for (const value of inputs) {
    state = 10; log.length = 0;
    const result = convert(value);
    const called = typeof value === "object";
    assert.sameValue(result, n);
    assert.sameValue(state, called ? 21 : 10);
    assert.compareArray(log, called ? [`valueOf:${n}:11`, `toString:${n}:21`] : []);
  }
}
