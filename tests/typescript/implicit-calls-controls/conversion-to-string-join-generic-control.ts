/*---
description: Control for conversion-to-string-join-generic; the conversion hook is called explicitly.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-to-string, ts-arrays]
---*/
// Control: ../implicit-calls/conversion-to-string-join-generic.ts; only the implicit hook route is made explicit.
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
function convert<T extends Hook>(items: (T)[]): string { return [items[0].toString(), items[1].toString()].join("|"); }
for (const n of [-2, -1, 0, 3]) {
  state = 10; log.length = 0;
  const left: Hook = new Box("left", n);
  const right: Hook = new Box("right", n + 1);
  const items: (Hook)[] = [left, right];
  const result = convert(items);
  assert.sameValue(result, `text:${n}|text:${n + 1}`);
  assert.compareArray(items, [left, right]);
  let expectedState = 10;
  const expected: string[] = [];
  expectedState += n + 7; expected.push(`toString:left:${n}:${expectedState}`);
  expectedState += n + 1 + 7; expected.push(`toString:right:${n + 1}:${expectedState}`);
  assert.sameValue(state, expectedState);
  assert.compareArray(log, expected);
}
