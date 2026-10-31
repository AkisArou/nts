/*---
description: Control for conversion-relational-less-generic; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints]
---*/
// Control: ../implicit-calls/conversion-relational-less-generic.ts; only the implicit hook route is made explicit.
interface Hook { valueOf(): number; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  label: string;
  value: number;
  constructor(label: string, value: number) { this.label = label; this.value = value; }
  valueOf(): number {
    state += this.value + 7; log.push(`valueOf:${this.label}:${this.value}:${state}`);
    return this.value;
  }
}
function compare<T extends Hook>(left: T, right: T): boolean { return left.valueOf() < right.valueOf(); }
for (const n of [-2, -1, 0, 1, 3]) {
  state = 10; log.length = 0;
  const left: Hook = new Box("left", n);
  const right: Hook = new Box("right", 1);
  const result = compare(left, right);
  assert.sameValue(result, n < 1);
  assert.sameValue(state, n + 25);
  assert.compareArray(log, [`valueOf:left:${n}:${n + 17}`, `valueOf:right:1:${n + 25}`]);
}
