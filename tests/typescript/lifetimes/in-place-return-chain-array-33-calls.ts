/*---
description: An array retained through 33 distinct returns prevents source reuse.
features: [ts-lifetime-in-place, ts-route-return-chain, ts-functions, ts-iteration, ts-arrays, ts-objects]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: 33 return summaries relay an alias; Node keeps the pre-update source after churn.
function make(n: number): number[] { return [n, n + 1, n + 2]; }
function check(xs: number[], n: number): void { assert.sameValue(xs.length, 3); assert.sameValue(xs[0], n); assert.sameValue(xs[1], n + 1); assert.sameValue(xs[2], n + 2); }
function churn(n: number): void { const all: number[][] = []; for (let i = 0; i < 24; i++) all.push(make(n + i + 1000)); for (let i = 0; i < all.length; i++) check(all[i], n + i + 1000); }
function r1(value: number[]): number[] { return r2(value); }
function r2(value: number[]): number[] { return r3(value); }
function r3(value: number[]): number[] { return r4(value); }
function r4(value: number[]): number[] { return r5(value); }
function r5(value: number[]): number[] { return r6(value); }
function r6(value: number[]): number[] { return r7(value); }
function r7(value: number[]): number[] { return r8(value); }
function r8(value: number[]): number[] { return r9(value); }
function r9(value: number[]): number[] { return r10(value); }
function r10(value: number[]): number[] { return r11(value); }
function r11(value: number[]): number[] { return r12(value); }
function r12(value: number[]): number[] { return r13(value); }
function r13(value: number[]): number[] { return r14(value); }
function r14(value: number[]): number[] { return r15(value); }
function r15(value: number[]): number[] { return r16(value); }
function r16(value: number[]): number[] { return r17(value); }
function r17(value: number[]): number[] { return r18(value); }
function r18(value: number[]): number[] { return r19(value); }
function r19(value: number[]): number[] { return r20(value); }
function r20(value: number[]): number[] { return r21(value); }
function r21(value: number[]): number[] { return r22(value); }
function r22(value: number[]): number[] { return r23(value); }
function r23(value: number[]): number[] { return r24(value); }
function r24(value: number[]): number[] { return r25(value); }
function r25(value: number[]): number[] { return r26(value); }
function r26(value: number[]): number[] { return r27(value); }
function r27(value: number[]): number[] { return r28(value); }
function r28(value: number[]): number[] { return r29(value); }
function r29(value: number[]): number[] { return r30(value); }
function r30(value: number[]): number[] { return r31(value); }
function r31(value: number[]): number[] { return r32(value); }
function r32(value: number[]): number[] { return r33(value); }
function r33(value: number[]): number[] { return value; }
for (let n = 0; n < 240; n++) {
  let text = make(n);
  const saved = r1(text);
  text = text.map(value => value + 100);

  const witness = { value: saved };
  churn(n);
  assert.sameValue(saved === witness.value, true);
  assert.sameValue(saved === text, false);
  check(saved, n); check(text, n + 100);
}
