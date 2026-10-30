/*---
description: A late receiver class reaches the final call only after twenty-four loop-carried dependencies.
features: [ts-proof-call-target, ts-route-chain, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: reverse-order updates need 24 back edges to carry Next to r24; node changes result at 24.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterChain(turns: number): number {
  const original = new Base();
  const replacement = new Next();
  let r1: Base = original; let r2: Base = original; let r3: Base = original; let r4: Base = original;
  let r5: Base = original; let r6: Base = original; let r7: Base = original; let r8: Base = original;
  let r9: Base = original; let r10: Base = original; let r11: Base = original; let r12: Base = original;
  let r13: Base = original; let r14: Base = original; let r15: Base = original; let r16: Base = original;
  let r17: Base = original; let r18: Base = original; let r19: Base = original; let r20: Base = original;
  let r21: Base = original; let r22: Base = original; let r23: Base = original; let r24: Base = original;
  for (let turn = 0; turn < turns; turn++) {
    r24 = r23; r23 = r22; r22 = r21; r21 = r20;
    r20 = r19; r19 = r18; r18 = r17; r17 = r16;
    r16 = r15; r15 = r14; r14 = r13; r13 = r12;
    r12 = r11; r11 = r10; r10 = r9; r9 = r8;
    r8 = r7; r7 = r6; r6 = r5; r5 = r4;
    r4 = r3; r3 = r2; r2 = r1;
    r1 = replacement;
  }
  return r24.run(1);
}
for (const n of [0, 1, 23, 24, 25, 32]) {
  assert.sameValue(afterChain(n), n < 24 ? 101 : 201);
}
