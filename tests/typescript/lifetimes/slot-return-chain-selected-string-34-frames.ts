/*---
description: An early bounded string survives later iterations and thirty-four return frames.
features: [ts-lifetime-slot, ts-route-return-chain, ts-functions, ts-strings]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: the selected string is returned through 34 distinct functions. Node preserves every retained iteration.
function check(text: string, id: number): void {
  assert.sameValue(text, String.fromCharCode(65 + id % 26, 97 + id % 26));
  assert.sameValue(text.length, 2);
}
function r0(n: number): string {
  let saved = "";
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const text = String.fromCharCode(65 + id % 26) + String.fromCharCode(97 + id % 26);
    assert.sameValue(text.length, 2);
    if (i === 1) saved = text;
  }
  return saved;
}
function r1(n: number): string { return r0(n); }
function r2(n: number): string { return r1(n); }
function r3(n: number): string { return r2(n); }
function r4(n: number): string { return r3(n); }
function r5(n: number): string { return r4(n); }
function r6(n: number): string { return r5(n); }
function r7(n: number): string { return r6(n); }
function r8(n: number): string { return r7(n); }
function r9(n: number): string { return r8(n); }
function r10(n: number): string { return r9(n); }
function r11(n: number): string { return r10(n); }
function r12(n: number): string { return r11(n); }
function r13(n: number): string { return r12(n); }
function r14(n: number): string { return r13(n); }
function r15(n: number): string { return r14(n); }
function r16(n: number): string { return r15(n); }
function r17(n: number): string { return r16(n); }
function r18(n: number): string { return r17(n); }
function r19(n: number): string { return r18(n); }
function r20(n: number): string { return r19(n); }
function r21(n: number): string { return r20(n); }
function r22(n: number): string { return r21(n); }
function r23(n: number): string { return r22(n); }
function r24(n: number): string { return r23(n); }
function r25(n: number): string { return r24(n); }
function r26(n: number): string { return r25(n); }
function r27(n: number): string { return r26(n); }
function r28(n: number): string { return r27(n); }
function r29(n: number): string { return r28(n); }
function r30(n: number): string { return r29(n); }
function r31(n: number): string { return r30(n); }
function r32(n: number): string { return r31(n); }
function r33(n: number): string { return r32(n); }
for (let n = 0; n < 240; n++) {
  const saved = r33(n);
  for (let k = 0; k < 4; k++) check(r33(n + 512 + k), (n + 512 + k) * 8 + 1);
  check(saved, n * 8 + 1);
}
