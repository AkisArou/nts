/*---
description: A string retained through 33 distinct returns prevents source reuse.
features: [ts-lifetime-in-place, ts-route-return-chain, ts-functions, ts-iteration, ts-strings, ts-arrays]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: 33 return summaries relay an alias; Node keeps the pre-update source after churn.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void { for (let i = 0; i < 24; i++) assert(make(n + 1000 + i).length > 0); }
function r1(value: string): string { return r2(value); }
function r2(value: string): string { return r3(value); }
function r3(value: string): string { return r4(value); }
function r4(value: string): string { return r5(value); }
function r5(value: string): string { return r6(value); }
function r6(value: string): string { return r7(value); }
function r7(value: string): string { return r8(value); }
function r8(value: string): string { return r9(value); }
function r9(value: string): string { return r10(value); }
function r10(value: string): string { return r11(value); }
function r11(value: string): string { return r12(value); }
function r12(value: string): string { return r13(value); }
function r13(value: string): string { return r14(value); }
function r14(value: string): string { return r15(value); }
function r15(value: string): string { return r16(value); }
function r16(value: string): string { return r17(value); }
function r17(value: string): string { return r18(value); }
function r18(value: string): string { return r19(value); }
function r19(value: string): string { return r20(value); }
function r20(value: string): string { return r21(value); }
function r21(value: string): string { return r22(value); }
function r22(value: string): string { return r23(value); }
function r23(value: string): string { return r24(value); }
function r24(value: string): string { return r25(value); }
function r25(value: string): string { return r26(value); }
function r26(value: string): string { return r27(value); }
function r27(value: string): string { return r28(value); }
function r28(value: string): string { return r29(value); }
function r29(value: string): string { return r30(value); }
function r30(value: string): string { return r31(value); }
function r31(value: string): string { return r32(value); }
function r32(value: string): string { return r33(value); }
function r33(value: string): string { return value; }
for (let n = 0; n < 240; n++) {
  let text = make(n);
  const saved = r1(text);
  text += ":grown";

  churn(n);
  assert.sameValue(saved, "key:" + n + ":old");
  assert.sameValue(saved.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old:grown");
}
