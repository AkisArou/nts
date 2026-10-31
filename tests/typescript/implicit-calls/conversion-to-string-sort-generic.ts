/*---
description: Array sort invokes toString through a generic constrained to Hook and preserves the two-element hook order.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-to-string, ts-arrays]
---*/
// Route: array sort through a generic constrained to Hook; node preserves every hook call, its effect and the result.
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
function convert<T extends Hook>(items: (T)[]): (T)[] { return items.sort(); }
for (const n of [2, 9, 10, 11]) {
  state = 10; log.length = 0;
  const left: Hook = new Box("left", n + 1);
  const right: Hook = new Box("right", n);
  const items: (Hook)[] = [left, right];
  const result = convert(items);
  assert.sameValue(result, items);
  const leftFirst = `text:${n + 1}` < `text:${n}`;
  assert.compareArray(result, leftFirst ? [left, right] : [right, left]);
  let expectedState = 10;
  const expected: string[] = [];
  expectedState += n + 7; expected.push(`toString:right:${n}:${expectedState}`);
  expectedState += n + 1 + 7; expected.push(`toString:left:${n + 1}:${expectedState}`);
  assert.sameValue(state, expectedState);
  assert.compareArray(log, expected);
}
