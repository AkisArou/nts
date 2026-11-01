/*---
description: An inherited static entry method dispatches this.step to overrides on three constructor receivers.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Route: typeof MemberBase holds Base, Plus or Leaf; inherited Base.run dispatches this.step and retains the same constructor receiver.
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
function useStatic(receiver: typeof MemberBase, next: number): number { return receiver.run(next); }
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
