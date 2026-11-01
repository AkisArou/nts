/*---
description: Control for members-static-overridden-target; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
class MemberBase {
  static kind: string = "base"; static state: number = 0;
  static run(next: number): number { log.push("Base.run", this, next); this.state = next; return next + 1; }
}
class MemberPlus extends MemberBase {
  static override kind: string = "plus"; static override state: number = 0;
  static override run(next: number): number { log.push("Plus.run", this, next); this.state = next + 10; return this.state; }
}
class MemberTimes extends MemberBase {
  static override kind: string = "times"; static padding: string = "times"; static override state: number = 0;
  static override run(next: number): number { log.push("Times.run", this, next); this.state = next * 3; return this.state - 1; }
}
function baseRun(receiver: typeof MemberBase, next: number): number { log.push("Base.run", receiver, next); receiver.state = next; return next + 1; }
function plusRun(receiver: typeof MemberBase, next: number): number { log.push("Plus.run", receiver, next); receiver.state = next + 10; return receiver.state; }
function timesRun(receiver: typeof MemberBase, next: number): number { log.push("Times.run", receiver, next); receiver.state = next * 3; return receiver.state - 1; }
function useStatic(receiver: typeof MemberBase, next: number): number {
  if (receiver.kind === "base") return baseRun(receiver, next);
  return receiver.kind === "plus" ? plusRun(receiver, next) : timesRun(receiver, next);
}
for (const next of [-2, 0, 5]) {
  MemberBase.state = 0; MemberPlus.state = 0; MemberTimes.state = 0;
  const rows = [{ receiver: MemberBase, label: "Base", result: next + 1, state: next },
    { receiver: MemberPlus, label: "Plus", result: next + 10, state: next + 10 },
    { receiver: MemberTimes, label: "Times", result: next * 3 - 1, state: next * 3 }];
  for (const row of rows) {
    log.length = 0; const result = useStatic(row.receiver, next);
    assert.sameValue(result, row.result); assert.sameValue(row.receiver.state, row.state);
    assert.compareArray(log, [row.label + ".run", row.receiver, next]);
  }
  assert.sameValue(MemberBase.state, next); assert.sameValue(MemberPlus.state, next + 10); assert.sameValue(MemberTimes.state, next * 3);
}
