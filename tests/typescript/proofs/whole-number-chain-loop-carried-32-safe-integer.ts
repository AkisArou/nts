/*---
description: A late wide integer crosses 32 loop-carried slots before observation.
features: [ts-proof-whole-number, ts-route-chain, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: all 32 slots initially hold the whole integer zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: reverse-order updates need 32 back edges; node retains the late value and its arithmetic.
function throughBackEdges(turns: number): number {
  let v1 = 0, v2 = 0, v3 = 0, v4 = 0, v5 = 0, v6 = 0, v7 = 0, v8 = 0, v9 = 0, v10 = 0, v11 = 0, v12 = 0, v13 = 0, v14 = 0, v15 = 0, v16 = 0;
  let v17 = 0, v18 = 0, v19 = 0, v20 = 0, v21 = 0, v22 = 0, v23 = 0, v24 = 0, v25 = 0, v26 = 0, v27 = 0, v28 = 0, v29 = 0, v30 = 0, v31 = 0, v32 = 0;
  for (let i = 0; i < turns; i++) {
    v32 = v31;
    v31 = v30;
    v30 = v29;
    v29 = v28;
    v28 = v27;
    v27 = v26;
    v26 = v25;
    v25 = v24;
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
    v1 = 9007199254740992;
  }
  return (v32 + 1) - v32;
}

for (const n of [0, 1, 31, 32, 33, 40]) {
  assert.sameValue(throughBackEdges(n), n < 32 ? 1 : 0);
}
