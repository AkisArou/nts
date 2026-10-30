/*---
description: A fraction crossing 24 assignments is added before bitwise truncation.
features: [ts-proof-whole-number, ts-route-chain, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: all 25 slots begin with whole integers in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a changed source crosses 24 dependent assignments; node preserves the final value.
function throughAssignments(n: number): number {
  let v0 = 1, v1 = 1, v2 = 1, v3 = 1, v4 = 1, v5 = 1, v6 = 1, v7 = 1, v8 = 1, v9 = 1, v10 = 1, v11 = 1, v12 = 1;
  let v13 = 1, v14 = 1, v15 = 1, v16 = 1, v17 = 1, v18 = 1, v19 = 1, v20 = 1, v21 = 1, v22 = 1, v23 = 1, v24 = 1;
  if (n > 0) v0 = 0.75;
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
  return (v24 + v24) | 0;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(throughAssignments(n), n > 0 ? 1 : 2);
}
