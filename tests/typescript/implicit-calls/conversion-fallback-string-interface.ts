/*---
description: Tostring returning an object falls back to valueof through a declared Hook interface, preserving both effects.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-to-string, ts-objects]
---*/
// Route: string-hint fallback through a declared Hook interface; node preserves every hook call, its effect and the result.
interface Hook { toString(): object; valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): object { state += 1; log.push(`toString:${this.value}:${state}`); return this; }
  valueOf(): number { state += 10; log.push(`valueOf:${this.value}:${state}`); return this.value; }
}
function convert(value: Hook): string { return String(value); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, String(n));
  assert.sameValue(state, 21);
  assert.compareArray(log, [`toString:${n}:11`, `valueOf:${n}:21`]);
}
