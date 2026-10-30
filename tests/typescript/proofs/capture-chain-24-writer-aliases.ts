/*---
description: A writer reached through twenty-four function aliases updates its sibling reader binding.
features: [ts-proof-capture, ts-route-chain, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: 24 dependent assignments carry the writer to its call; node updates the original captured local.
function afterChain(n: number): number {
  let value = 0;
  const read = (): number => value;
  const w0 = (next: number): void => { value = next; };
  const w1 = w0;
  const w2 = w1;
  const w3 = w2;
  const w4 = w3;
  const w5 = w4;
  const w6 = w5;
  const w7 = w6;
  const w8 = w7;
  const w9 = w8;
  const w10 = w9;
  const w11 = w10;
  const w12 = w11;
  const w13 = w12;
  const w14 = w13;
  const w15 = w14;
  const w16 = w15;
  const w17 = w16;
  const w18 = w17;
  const w19 = w18;
  const w20 = w19;
  const w21 = w20;
  const w22 = w21;
  const w23 = w22;
  const w24 = w23;
  w24(n);
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterChain(n), n);
