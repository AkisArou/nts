/*---
description: A selected loop object survives later instances and thirty-four return frames.
features: [ts-lifetime-slot, ts-route-return-chain, ts-functions, ts-objects]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: the early survivor is returned through 34 distinct functions. Node preserves every retained iteration.
type Cell = { id: number; score: number };
type Saved = { value: Cell; identity: Cell };
function r0(n: number): Saved {
  let saved: Saved | undefined;
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1 };
    assert.sameValue(value.score - value.id * 5, 1);
    if (i === 1) saved = { value, identity: value };
  }
  if (saved === undefined) throw new Test262Error("missing survivor");
  return saved;
}
function r1(n: number): Saved { return r0(n); }
function r2(n: number): Saved { return r1(n); }
function r3(n: number): Saved { return r2(n); }
function r4(n: number): Saved { return r3(n); }
function r5(n: number): Saved { return r4(n); }
function r6(n: number): Saved { return r5(n); }
function r7(n: number): Saved { return r6(n); }
function r8(n: number): Saved { return r7(n); }
function r9(n: number): Saved { return r8(n); }
function r10(n: number): Saved { return r9(n); }
function r11(n: number): Saved { return r10(n); }
function r12(n: number): Saved { return r11(n); }
function r13(n: number): Saved { return r12(n); }
function r14(n: number): Saved { return r13(n); }
function r15(n: number): Saved { return r14(n); }
function r16(n: number): Saved { return r15(n); }
function r17(n: number): Saved { return r16(n); }
function r18(n: number): Saved { return r17(n); }
function r19(n: number): Saved { return r18(n); }
function r20(n: number): Saved { return r19(n); }
function r21(n: number): Saved { return r20(n); }
function r22(n: number): Saved { return r21(n); }
function r23(n: number): Saved { return r22(n); }
function r24(n: number): Saved { return r23(n); }
function r25(n: number): Saved { return r24(n); }
function r26(n: number): Saved { return r25(n); }
function r27(n: number): Saved { return r26(n); }
function r28(n: number): Saved { return r27(n); }
function r29(n: number): Saved { return r28(n); }
function r30(n: number): Saved { return r29(n); }
function r31(n: number): Saved { return r30(n); }
function r32(n: number): Saved { return r31(n); }
function r33(n: number): Saved { return r32(n); }
for (let n = 0; n < 240; n++) {
  const saved = r33(n);
  const fresh = r33(n + 512);
  assert.sameValue(fresh.value.score, ((n + 512) * 8 + 1) * 5 + 1);
  assert.sameValue(saved.value === saved.identity, true);
  assert.sameValue(saved.value.id, n * 8 + 1);
  assert.sameValue(saved.value.score, (n * 8 + 1) * 5 + 1);
}
