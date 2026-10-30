/*---
description: A later method caller supplies negative zero after whole integer arguments.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-class]
---*/
// Fact: the first method call site supplies only int32 arguments (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the later method call supplies -0; node preserves its sign at the return.
class Reader {
  read(value: number): number { return value; }
}

const reader = new Reader();
for (const n of [0, 1, 3, 7]) {
  assert.sameValue(reader.read(n | 0), n);
  assert.sameValue(reader.read(n > 0 ? -0 : 0), n > 0 ? -0 : 0);
}
