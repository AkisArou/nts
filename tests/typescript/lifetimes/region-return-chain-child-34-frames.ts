/*---
description: A detached child survives thirty-four distinct return frames.
features: [ts-lifetime-region, ts-route-return-chain, ts-functions, ts-objects, ts-strings]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: 34 distinct functions return the leaf pair after the builder root dies. Node preserves the retained value after the result dies.
type Cell = { id: number; value: number; text: string };
type Saved = { value: Cell; identity: Cell };
function build(n: number): { left: Cell; right: Cell } {
  const leaf = { id: n, value: n * 3 + 7, text: "leaf:" + n };
  return { left: leaf, right: leaf };
}
function r0(n: number): Saved { const root = build(n); return { value: root.left, identity: root.right }; }
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
  for (let i = 0; i < 8; i++) {
    const fresh = build(n + 512 + i);
    assert.sameValue(fresh.left.value + fresh.right.id, (n + 512 + i) * 4 + 7);
  }
  assert.sameValue(saved.value === saved.identity, true);
  assert.sameValue(saved.value.id, n);
  assert.sameValue(saved.value.value, n * 3 + 7);
  assert.sameValue(saved.value.text, "leaf:" + n);
  assert.sameValue(saved.value.text.length, 5 + String(n).length);
}
