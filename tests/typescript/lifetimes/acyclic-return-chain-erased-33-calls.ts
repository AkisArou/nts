/*---
description: A backedge returned through 33 distinct calls closes a erased cycle.
features: [ts-lifetime-acyclic, ts-route-return-chain, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: 33 return summaries relay the reference that closes the cycle; Node retains its exact target.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
class Cell { id: number; edge: unknown = null; constructor(n: number) { this.id = n; } }
function churn(n: number): void { const all: Cell[] = []; for (let i = 0; i < 24; i++) all.push(new Cell(n + i + 1000)); for (let i = 0; i < all.length; i++) assert.sameValue(all[i].id, n + i + 1000); }
function r1(value: unknown): unknown { return r2(value); }
function r2(value: unknown): unknown { return r3(value); }
function r3(value: unknown): unknown { return r4(value); }
function r4(value: unknown): unknown { return r5(value); }
function r5(value: unknown): unknown { return r6(value); }
function r6(value: unknown): unknown { return r7(value); }
function r7(value: unknown): unknown { return r8(value); }
function r8(value: unknown): unknown { return r9(value); }
function r9(value: unknown): unknown { return r10(value); }
function r10(value: unknown): unknown { return r11(value); }
function r11(value: unknown): unknown { return r12(value); }
function r12(value: unknown): unknown { return r13(value); }
function r13(value: unknown): unknown { return r14(value); }
function r14(value: unknown): unknown { return r15(value); }
function r15(value: unknown): unknown { return r16(value); }
function r16(value: unknown): unknown { return r17(value); }
function r17(value: unknown): unknown { return r18(value); }
function r18(value: unknown): unknown { return r19(value); }
function r19(value: unknown): unknown { return r20(value); }
function r20(value: unknown): unknown { return r21(value); }
function r21(value: unknown): unknown { return r22(value); }
function r22(value: unknown): unknown { return r23(value); }
function r23(value: unknown): unknown { return r24(value); }
function r24(value: unknown): unknown { return r25(value); }
function r25(value: unknown): unknown { return r26(value); }
function r26(value: unknown): unknown { return r27(value); }
function r27(value: unknown): unknown { return r28(value); }
function r28(value: unknown): unknown { return r29(value); }
function r29(value: unknown): unknown { return r30(value); }
function r30(value: unknown): unknown { return r31(value); }
function r31(value: unknown): unknown { return r32(value); }
function r32(value: unknown): unknown { return r33(value); }
function r33(value: unknown): unknown { return value; }
for (let n = 0; n < 240; n++) {

const value = new Cell(n);
value.edge = r1(value);
  churn(n);

assert.sameValue(value.id, n);
assert.sameValue(value.edge === value, true);
}
