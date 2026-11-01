/*---
description: Control for members-static-this-method; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
class MemberBase {
  static kind: string = "base"; static state: number = 0;
  static step(next: number): number { log.push("Base.step", this, next); this.state = next; return next + 1; }
  static run(next: number): number { log.push("Base.run", this, next); return this.step(next) * 2; }
}
class MemberPlus extends MemberBase {
  static override kind: string = "plus"; static override state: number = 0;
  static override step(next: number): number { log.push("Plus.step", this, next); this.state = next + 10; return this.state; }
}
class MemberLeaf extends MemberPlus {
  static override kind: string = "leaf"; static override state: number = 0;
  static override step(next: number): number { log.push("Leaf.step", this, next); this.state = next * 3; return this.state - 1; }
}
function baseStep(receiver: typeof MemberBase, next: number): number { log.push("Base.step", receiver, next); receiver.state = next; return next + 1; }
function plusStep(receiver: typeof MemberBase, next: number): number { log.push("Plus.step", receiver, next); receiver.state = next + 10; return receiver.state; }
function leafStep(receiver: typeof MemberBase, next: number): number { log.push("Leaf.step", receiver, next); receiver.state = next * 3; return receiver.state - 1; }
function baseRun(receiver: typeof MemberBase, next: number): number {
  log.push("Base.run", receiver, next);
  if (receiver.kind === "base") return baseStep(receiver, next) * 2;
  return (receiver.kind === "plus" ? plusStep(receiver, next) : leafStep(receiver, next)) * 2;
}
function useStatic(receiver: typeof MemberBase, next: number): number {
  if (receiver.kind === "base") return baseRun(receiver, next);
  if (receiver.kind === "plus") return baseRun(receiver, next);
  return baseRun(receiver, next);
}
for (const next of [-2, 0, 5]) {
  const rows = [{ receiver: MemberBase, label: "Base", result: 2 * (next + 1), state: next },
    { receiver: MemberPlus, label: "Plus", result: 2 * (next + 10), state: next + 10 },
    { receiver: MemberLeaf, label: "Leaf", result: 2 * (next * 3 - 1), state: next * 3 }];
  for (const row of rows) {
    log.length = 0; const result = useStatic(row.receiver, next);
    assert.sameValue(result, row.result); assert.sameValue(row.receiver.state, row.state);
    assert.compareArray(log, ["Base.run", row.receiver, next, row.label + ".step", row.receiver, next]);
  }
  assert.sameValue(MemberBase.state, next); assert.sameValue(MemberPlus.state, next + 10); assert.sameValue(MemberLeaf.state, next * 3);
}
