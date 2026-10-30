/*---
description: Interface callers contribute fractional arguments to each implementation signature.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class]
---*/
// Fact: the initial calls pass whole one through the interface signature (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a later interface call supplies 3.5; node retains each implementation's fraction.
interface Reader {
  read(value: number): number;
}
class Identity implements Reader {
  read(value: number): number { return value; }
}
class Offset implements Reader {
  read(value: number): number { return value + 1; }
}
function throughInterface(reader: Reader, value: number): number {
  return reader.read(value);
}

const identity = new Identity();
const offset = new Offset();
assert.sameValue(throughInterface(identity, 1), 1);
assert.sameValue(throughInterface(offset, 1), 2);
for (const n of [-1, 0, 1, 3, 7]) {
  const value = n > 0 ? 3.5 : 1;
  assert.sameValue(throughInterface(identity, value), n > 0 ? 3.5 : 1);
  assert.sameValue(throughInterface(offset, value), n > 0 ? 4.5 : 2);
}
