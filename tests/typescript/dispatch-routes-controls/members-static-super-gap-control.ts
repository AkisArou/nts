/*---
description: Control for members-static-super-gap; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
class MemberBase {
  static kind: string = "base"; static total: number = 0;
  static run(next: number): number { log.push("Base.run", this, next); this.total += next; return next + 1; }
}
class MemberMiddle extends MemberBase {
  static override kind: string = "middle"; static override total: number = 0;
  static override run(next: number): number { log.push("Middle.run", this, next); return super.run(next + 10) + 100; }
}
class MemberGap extends MemberMiddle { static override kind: string = "gap"; static override total: number = 0; }
class MemberLeaf extends MemberGap {
  static override kind: string = "leaf"; static override total: number = 0;
  static override run(next: number): number { log.push("Leaf.run", this, next); return super.run(next * 2) + 1000; }
}
function baseRun(receiver: typeof MemberBase, next: number): number { log.push("Base.run", receiver, next); receiver.total += next; return next + 1; }
function middleRun(receiver: typeof MemberBase, next: number): number { log.push("Middle.run", receiver, next); return baseRun(receiver, next + 10) + 100; }
function leafRun(receiver: typeof MemberBase, next: number): number { log.push("Leaf.run", receiver, next); return middleRun(receiver, next * 2) + 1000; }
function useStatic(receiver: typeof MemberBase, next: number): number {
  return receiver.kind === "leaf" ? leafRun(receiver, next) : middleRun(receiver, next);
}
for (const next of [-2, 0, 5]) for (const receiver of [MemberMiddle, MemberGap, MemberLeaf]) {
  log.length = 0; const leaf = receiver.kind === "leaf"; const passed = leaf ? next * 2 : next;
  const before = receiver.total; const result = useStatic(receiver, next); const expected: unknown[] = [];
  if (leaf) expected.push("Leaf.run", receiver, next);
  expected.push("Middle.run", receiver, passed, "Base.run", receiver, passed + 10);
  assert.sameValue(result, passed + (leaf ? 1111 : 111)); assert.sameValue(receiver.total, before + passed + 10);
  assert.compareArray(log, expected);
}
assert.sameValue(MemberBase.total, 0); assert.sameValue(MemberMiddle.total, 33);
assert.sameValue(MemberGap.total, 33); assert.sameValue(MemberLeaf.total, 36);
