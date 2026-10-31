/*---
description: Control for conversion-relational-greater-equal-union; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions]
---*/
// Control: ../implicit-calls/conversion-relational-greater-equal-union.ts; only the implicit hook route is made explicit.
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
function compare(left: number | Hook, right: number | Hook): boolean { return (typeof left === "number" ? left : left.valueOf()) >= (typeof right === "number" ? right : right.valueOf()); }
for (const n of [-2, -1, 0, 1, 3]) {
  state = 10; log.length = 0;
  const left: number | Hook = n % 2 === 0 ? n : new Box("left", n);
  const right: number | Hook = n < 0 ? 1 : new Box("right", 1);
  const result = compare(left, right);
  assert.sameValue(result, n >= 1);
  let expectedState = 10;
  const expected: string[] = [];
  if (typeof left === "object") { expectedState += n + 7; expected.push(`valueOf:left:${n}:${expectedState}`); }
  if (typeof right === "object") { expectedState += 8; expected.push(`valueOf:right:1:${expectedState}`); }
  assert.sameValue(state, expectedState);
  assert.compareArray(log, expected);
}
