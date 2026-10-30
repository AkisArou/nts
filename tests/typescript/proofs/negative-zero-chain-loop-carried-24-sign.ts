/*---
description: A negative-zero update takes 24 back edges to reach the final numeric slot.
features: [ts-proof-negative-zero, ts-route-chain, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: all 24 slots initially hold positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: reverse-order updates propagate the sign one slot per iteration; node reads -0 at depth 24.
function throughBackEdges(turns: number): number {
  let v1 = 0, v2 = 0, v3 = 0, v4 = 0, v5 = 0, v6 = 0, v7 = 0, v8 = 0, v9 = 0, v10 = 0, v11 = 0, v12 = 0;
  let v13 = 0, v14 = 0, v15 = 0, v16 = 0, v17 = 0, v18 = 0, v19 = 0, v20 = 0, v21 = 0, v22 = 0, v23 = 0, v24 = 0;
  for (let i = 0; i < turns; i++) {
    v24 = v23;
    v23 = v22;
    v22 = v21;
    v21 = v20;
    v20 = v19;
    v19 = v18;
    v18 = v17;
    v17 = v16;
    v16 = v15;
    v15 = v14;
    v14 = v13;
    v13 = v12;
    v12 = v11;
    v11 = v10;
    v10 = v9;
    v9 = v8;
    v8 = v7;
    v7 = v6;
    v6 = v5;
    v5 = v4;
    v4 = v3;
    v3 = v2;
    v2 = v1;
    v1 = -0;
  }
  return v24;
}

for (const n of [0, 1, 23, 24, 25, 32]) {
  assert.sameValue(throughBackEdges(n), n < 24 ? 0 : -0);
}
