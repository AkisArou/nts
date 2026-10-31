/*---
description: A local object returned through 34 functions has one identity for later field writes.
features: [ts-lifetime-scalar, ts-route-return-chain, ts-functions, ts-iteration, ts-objects]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: 33 return edges expose two aliases; Node shares writes after every producing frame has ended.
type Point = { x: number; y: number };
type Pair = { first: Point; second: Point };
function r0(n: number): Pair { return r1(n); }
function r1(n: number): Pair { return r2(n); }
function r2(n: number): Pair { return r3(n); }
function r3(n: number): Pair { return r4(n); }
function r4(n: number): Pair { return r5(n); }
function r5(n: number): Pair { return r6(n); }
function r6(n: number): Pair { return r7(n); }
function r7(n: number): Pair { return r8(n); }
function r8(n: number): Pair { return r9(n); }
function r9(n: number): Pair { return r10(n); }
function r10(n: number): Pair { return r11(n); }
function r11(n: number): Pair { return r12(n); }
function r12(n: number): Pair { return r13(n); }
function r13(n: number): Pair { return r14(n); }
function r14(n: number): Pair { return r15(n); }
function r15(n: number): Pair { return r16(n); }
function r16(n: number): Pair { return r17(n); }
function r17(n: number): Pair { return r18(n); }
function r18(n: number): Pair { return r19(n); }
function r19(n: number): Pair { return r20(n); }
function r20(n: number): Pair { return r21(n); }
function r21(n: number): Pair { return r22(n); }
function r22(n: number): Pair { return r23(n); }
function r23(n: number): Pair { return r24(n); }
function r24(n: number): Pair { return r25(n); }
function r25(n: number): Pair { return r26(n); }
function r26(n: number): Pair { return r27(n); }
function r27(n: number): Pair { return r28(n); }
function r28(n: number): Pair { return r29(n); }
function r29(n: number): Pair { return r30(n); }
function r30(n: number): Pair { return r31(n); }
function r31(n: number): Pair { return r32(n); }
function r32(n: number): Pair { return r33(n); }
function r33(n: number): Pair { const point = { x: n, y: n + 11 }; point.y += point.x; return { first: point, second: point }; }

for (let n = 0; n < 240; n++) {
  const saved = r0(n);
  for (let j = 1; j <= 12; j++) assert.sameValue(r0(n + j).first.y, 2 * (n + j) + 11);
  assert.sameValue(saved.first === saved.second, true);
  assert.sameValue(saved.first.x, n);
  assert.sameValue(saved.first.y, 2 * n + 11);
  saved.first.x += 101;
  saved.second.y -= 37;
  assert.sameValue(saved.second.x, n + 101);
  assert.sameValue(saved.first.y, 2 * n - 26);
}
