/*---
description: String addition falling back to tostring invokes the declared conversion hook through a declared Hook interface.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-to-string]
---*/
// Route: string addition falling back to toString through a declared Hook interface; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `text:${this.value}`; }
}
function convert(value: Hook): string { return value + "!"; }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, `text:${n}!`);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`toString:${n}:${n + 17}`]);
}
