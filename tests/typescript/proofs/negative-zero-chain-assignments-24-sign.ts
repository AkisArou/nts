/*---
description: A negative-zero update propagates through 24 initialized numeric slots.
features: [ts-proof-negative-zero, ts-route-chain, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: all 25 slots initially hold positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the late sign change crosses 24 dependent assignments; node retains -0.
function throughAssignments(n: number): number {
  let v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0, v5 = 0, v6 = 0, v7 = 0, v8 = 0, v9 = 0, v10 = 0, v11 = 0, v12 = 0;
  let v13 = 0, v14 = 0, v15 = 0, v16 = 0, v17 = 0, v18 = 0, v19 = 0, v20 = 0, v21 = 0, v22 = 0, v23 = 0, v24 = 0;
  if (n > 0) v0 = -0;
  v1 = v0;
  v2 = v1;
  v3 = v2;
  v4 = v3;
  v5 = v4;
  v6 = v5;
  v7 = v6;
  v8 = v7;
  v9 = v8;
  v10 = v9;
  v11 = v10;
  v12 = v11;
  v13 = v12;
  v14 = v13;
  v15 = v14;
  v16 = v15;
  v17 = v16;
  v18 = v17;
  v19 = v18;
  v20 = v19;
  v21 = v20;
  v22 = v21;
  v23 = v22;
  v24 = v23;
  return v24;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(throughAssignments(n), n > 0 ? -0 : 0);
}
