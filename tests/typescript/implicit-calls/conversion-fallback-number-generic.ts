/*---
description: Valueof returning an object falls back to tostring through a generic constrained to Hook, preserving both effects.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-to-string, ts-objects]
---*/
// Route: number-hint fallback through a generic constrained to Hook; node preserves every hook call, its effect and the result.
interface Hook { valueOf(): object; toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): object { state += 1; log.push(`valueOf:${this.value}:${state}`); return this; }
  toString(): string { state += 10; log.push(`toString:${this.value}:${state}`); return String(this.value); }
}
function convert<T extends Hook>(value: T): number { return Number(value); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, n);
  assert.sameValue(state, 21);
  assert.compareArray(log, [`valueOf:${n}:11`, `toString:${n}:21`]);
}
