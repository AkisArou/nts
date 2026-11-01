/*---
description: An inherited static method creates receiver-local fields while untouched subclasses still read the base field.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Route: typeof MemberBase cycles through Left, Base and Right; inherited add writes only its receiver, retaining each shadow after Base changes.
const log: unknown[] = [];
for (const next of [-2, 0, 5]) {
  class MemberBase {
    static kind: string = "base"; static value: number = 10;
    static add(amount: number): number { log.push("Base.add", this, amount, this.value); this.value += amount; return this.value; }
  }
  class MemberLeft extends MemberBase { static override kind: string = "left"; }
  class MemberRight extends MemberBase { static override kind: string = "right"; }
  function useStatic(receiver: typeof MemberBase, amount: number): number { return receiver.add(amount); }
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
