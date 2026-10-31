/*---
description: A local bounded string survives 35 distinct returning functions.
features: [ts-lifetime-frame, ts-route-return-chain, ts-functions, ts-iteration, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: 34 return edges carry the local beyond its frame; node keeps the original value after more calls.
function r0(n: number): string { return r1(n); }
function r1(n: number): string { return r2(n); }
function r2(n: number): string { return r3(n); }
function r3(n: number): string { return r4(n); }
function r4(n: number): string { return r5(n); }
function r5(n: number): string { return r6(n); }
function r6(n: number): string { return r7(n); }
function r7(n: number): string { return r8(n); }
function r8(n: number): string { return r9(n); }
function r9(n: number): string { return r10(n); }
function r10(n: number): string { return r11(n); }
function r11(n: number): string { return r12(n); }
function r12(n: number): string { return r13(n); }
function r13(n: number): string { return r14(n); }
function r14(n: number): string { return r15(n); }
function r15(n: number): string { return r16(n); }
function r16(n: number): string { return r17(n); }
function r17(n: number): string { return r18(n); }
function r18(n: number): string { return r19(n); }
function r19(n: number): string { return r20(n); }
function r20(n: number): string { return r21(n); }
function r21(n: number): string { return r22(n); }
function r22(n: number): string { return r23(n); }
function r23(n: number): string { return r24(n); }
function r24(n: number): string { return r25(n); }
function r25(n: number): string { return r26(n); }
function r26(n: number): string { return r27(n); }
function r27(n: number): string { return r28(n); }
function r28(n: number): string { return r29(n); }
function r29(n: number): string { return r30(n); }
function r30(n: number): string { return r31(n); }
function r31(n: number): string { return r32(n); }
function r32(n: number): string { return r33(n); }
function r33(n: number): string { return r34(n); }
function r34(n: number): string { return String.fromCharCode(65 + n % 26); }

for (let n = 0; n < 240; n++) {
  const kept = r0(n);
  for (let j = 1; j <= 8; j++) assert.sameValue(r0(n + j), "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt((n + j) % 26));
  assert.sameValue(kept, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(n % 26));
  assert.sameValue(kept.length, 1);
}
