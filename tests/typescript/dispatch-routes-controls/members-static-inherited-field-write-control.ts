/*---
description: Control for members-static-inherited-field-write; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
for (const next of [-2, 0, 5]) {
  class MemberBase {
    static kind: string = "base"; static value: number = 10;
    static add(amount: number): number { log.push("Base.add", this, amount, this.value); this.value += amount; return this.value; }
  }
  class MemberLeft extends MemberBase { static override kind: string = "left"; }
  class MemberRight extends MemberBase { static override kind: string = "right"; }
  function baseAdd(receiver: typeof MemberBase, amount: number): number {
    log.push("Base.add", receiver, amount, receiver.value); receiver.value += amount; return receiver.value;
  }
  function useStatic(receiver: typeof MemberBase, amount: number): number {
    if (receiver.kind === "base") return baseAdd(receiver, amount);
    if (receiver.kind === "left") return baseAdd(receiver, amount);
    return baseAdd(receiver, amount);
  }
  const targets: (typeof MemberBase)[] = [MemberLeft, MemberBase, MemberRight];
  const starts = [10, 10, 10 + next]; const expectedValues = [10 + next, 10 + next, 10 + next * 2];
  for (let index = 0; index < targets.length; index++) {
    log.length = 0; const receiver = targets[index]; const result = useStatic(receiver, next);
    assert.sameValue(result, expectedValues[index]); assert.sameValue(receiver.value, expectedValues[index]);
    assert.compareArray(log, ["Base.add", receiver, next, starts[index]]);
  }
  MemberBase.value = 100;
  assert.sameValue(MemberLeft.value, 10 + next); assert.sameValue(MemberRight.value, 10 + next * 2);
  assert.sameValue(MemberBase.value, 100);
}
