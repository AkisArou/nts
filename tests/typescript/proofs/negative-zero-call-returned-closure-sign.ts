/*---
description: An escaped writer closure preserves negative zero for a separate reader closure.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-closures, ts-function-types, ts-objects]
---*/
// Fact: the factory binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a returned writer changes the binding before another closure reads; node retains -0.
function makePair(): { write: (negative: boolean) => void; read: () => number } {
  let value = 0;
  return {
    write(negative: boolean): void { value = negative ? -0 : 0; },
    read(): number { return value; }
  };
}

function afterReturnedWriter(n: number): number {
  const pair = makePair();
  pair.write(n > 0);
  return pair.read();
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterReturnedWriter(n), n > 0 ? -0 : 0);
}
