/*---
description: Control for conversion-value-of-string-plus-generic; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints]
---*/
// Control: ../implicit-calls/conversion-value-of-string-plus-generic.ts; only the implicit hook route is made explicit.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += this.value + 7; log.push(`valueOf:${this.value}:${state}`); return this.value; }
}
function convert<T extends Hook>(value: T): string { return value.valueOf() + "!"; }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, `${n}!`);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`valueOf:${n}:${n + 17}`]);
}
