/*---
description: Interface numeric signatures preserve the sign of zero at arguments and results.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class]
---*/
// Fact: the initial interface calls supply positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: later calls supply -0 through two implementations; node retains their distinct zero signs.
interface Reader {
  read(value: number): number;
}
class Keep implements Reader {
  read(value: number): number { return value; }
}
class Negate implements Reader {
  read(value: number): number { return -value; }
}
function invoke(reader: Reader, value: number): number {
  return reader.read(value);
}

const keep = new Keep();
const negate = new Negate();
assert.sameValue(invoke(keep, 0), 0);
assert.sameValue(invoke(negate, 0), -0);
for (const n of [-1, 0, 1, 3, 7]) {
  const value = n > 0 ? -0 : 0;
  assert.sameValue(invoke(keep, value), n > 0 ? -0 : 0);
  assert.sameValue(invoke(negate, value), n > 0 ? 0 : -0);
}
