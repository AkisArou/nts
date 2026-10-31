/*---
description: Number conversion invokes the declared conversion hook through a declared Hook interface.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive]
---*/
// Route: Number conversion through a declared Hook interface; node preserves every hook call, its effect and the result.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += this.value + 7; log.push(`valueOf:${this.value}:${state}`); return this.value; }
}
function convert(value: Hook): number { return Number(value); }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, n);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`valueOf:${n}:${n + 17}`]);
}
