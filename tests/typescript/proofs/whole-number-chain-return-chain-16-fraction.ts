/*---
description: A fractional return flows through sixteen numeric function summaries.
features: [ts-proof-whole-number, ts-route-chain, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the terminal binding begins with a whole integer (docs/foundations/numbers.md, Integers proved from doubles).
// Route: its late fraction must reach every dependent return; node preserves 0.25.
function stage1(n: number): number { return stage2(n); }
function stage2(n: number): number { return stage3(n); }
function stage3(n: number): number { return stage4(n); }
function stage4(n: number): number { return stage5(n); }
function stage5(n: number): number { return stage6(n); }
function stage6(n: number): number { return stage7(n); }
function stage7(n: number): number { return stage8(n); }
function stage8(n: number): number { return stage9(n); }
function stage9(n: number): number { return stage10(n); }
function stage10(n: number): number { return stage11(n); }
function stage11(n: number): number { return stage12(n); }
function stage12(n: number): number { return stage13(n); }
function stage13(n: number): number { return stage14(n); }
function stage14(n: number): number { return stage15(n); }
function stage15(n: number): number { return stage16(n); }
function stage16(n: number): number {
  let value = 1;
  if (n > 0) value = 0.25;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(stage1(n), n > 0 ? 0.25 : 1);
}
