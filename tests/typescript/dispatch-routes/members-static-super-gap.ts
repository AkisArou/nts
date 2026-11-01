/*---
description: Static super calls cross a non-overriding class and preserve the leaf constructor at every level.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Route: typeof MemberBase holds Middle, Gap or Leaf; static super enters Middle then Base on that constructor, never on the declaring class.
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
function useStatic(receiver: typeof MemberBase, next: number): number { return receiver.run(next); }
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
