/*---
description: A generic writer retains negative zero after a 24-step value chain.
features: [ts-proof-element-kind, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generics]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: 24 assignments feed a generic store; a separate reader keeps -0.
function store<T>(xs: T[], value: T): void { xs[0] = value; }
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1];
  const source = n > 0 ? -0 : 0;
  const a1 = source;
  const a2 = a1;
  const a3 = a2;
  const a4 = a3;
  const a5 = a4;
  const a6 = a5;
  const a7 = a6;
  const a8 = a7;
  const a9 = a8;
  const a10 = a9;
  const a11 = a10;
  const a12 = a11;
  const a13 = a12;
  const a14 = a13;
  const a15 = a14;
  const a16 = a15;
  const a17 = a16;
  const a18 = a17;
  const a19 = a18;
  const a20 = a19;
  const a21 = a20;
  const a22 = a21;
  const a23 = a22;
  const a24 = a23;
  store<number>(xs, a24);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -0 : 0);
}
