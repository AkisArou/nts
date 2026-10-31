/*---
description: A backedge returned through 33 distinct calls closes a structural cycle.
features: [ts-lifetime-acyclic, ts-route-return-chain, ts-functions, ts-iteration, ts-class, ts-arrays, ts-structural-typing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: 33 return summaries relay the reference that closes the cycle; Node retains its exact target.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
type Face = { id: number };
class Hub { id: number; children: Face[] = []; constructor(n: number) { this.id = n; } }
function churn(n: number): void { const all: Hub[] = []; for (let i = 0; i < 24; i++) all.push(new Hub(n + i + 1000)); for (let i = 0; i < all.length; i++) assert.sameValue(all[i].id, n + i + 1000); }
function r1(value: Face): Face { return r2(value); }
function r2(value: Face): Face { return r3(value); }
function r3(value: Face): Face { return r4(value); }
function r4(value: Face): Face { return r5(value); }
function r5(value: Face): Face { return r6(value); }
function r6(value: Face): Face { return r7(value); }
function r7(value: Face): Face { return r8(value); }
function r8(value: Face): Face { return r9(value); }
function r9(value: Face): Face { return r10(value); }
function r10(value: Face): Face { return r11(value); }
function r11(value: Face): Face { return r12(value); }
function r12(value: Face): Face { return r13(value); }
function r13(value: Face): Face { return r14(value); }
function r14(value: Face): Face { return r15(value); }
function r15(value: Face): Face { return r16(value); }
function r16(value: Face): Face { return r17(value); }
function r17(value: Face): Face { return r18(value); }
function r18(value: Face): Face { return r19(value); }
function r19(value: Face): Face { return r20(value); }
function r20(value: Face): Face { return r21(value); }
function r21(value: Face): Face { return r22(value); }
function r22(value: Face): Face { return r23(value); }
function r23(value: Face): Face { return r24(value); }
function r24(value: Face): Face { return r25(value); }
function r25(value: Face): Face { return r26(value); }
function r26(value: Face): Face { return r27(value); }
function r27(value: Face): Face { return r28(value); }
function r28(value: Face): Face { return r29(value); }
function r29(value: Face): Face { return r30(value); }
function r30(value: Face): Face { return r31(value); }
function r31(value: Face): Face { return r32(value); }
function r32(value: Face): Face { return r33(value); }
function r33(value: Face): Face { return value; }
for (let n = 0; n < 240; n++) {

const value = new Hub(n);
value.children.push(r1(value));
  churn(n);

assert.sameValue(value.id, n); assert.sameValue(value.children.length, 1);
assert.sameValue(value.children[0] === value, true);
}
