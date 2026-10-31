/*---
description: Array join invokes toString through a union of string and Hook and preserves the two-element hook order.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-unions, ts-to-string, ts-arrays]
---*/
// Route: array join through a union of string and Hook; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  label: string;
  value: number;
  constructor(label: string, value: number) { this.label = label; this.value = value; }
  toString(): string {
    state += this.value + 7; log.push(`toString:${this.label}:${this.value}:${state}`);
    return `text:${this.value}`;
  }
}
function convert(items: (string | Hook)[]): string { return items.join("|"); }
for (const n of [-2, -1, 0, 3]) {
  state = 10; log.length = 0;
  const left: string | Hook = n % 2 === 0 ? `text:${n}` : new Box("left", n);
  const right: string | Hook = n < 0 ? `text:${n + 1}` : new Box("right", n + 1);
  const items: (string | Hook)[] = [left, right];
  const result = convert(items);
  assert.sameValue(result, `text:${n}|text:${n + 1}`);
  assert.compareArray(items, [left, right]);
  let expectedState = 10;
  const expected: string[] = [];
  if (typeof left === "object") { expectedState += n + 7; expected.push(`toString:left:${n}:${expectedState}`); }
  if (typeof right === "object") { expectedState += n + 1 + 7; expected.push(`toString:right:${n + 1}:${expectedState}`); }
  assert.sameValue(state, expectedState);
  assert.compareArray(log, expected);
}
