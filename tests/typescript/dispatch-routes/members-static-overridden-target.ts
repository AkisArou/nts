/*---
description: A constructor typed as the base selects each static override and writes only that receiver state.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Route: typeof MemberBase holds Base, Plus or Times; run picks the matching static implementation and preserves separate class state.
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
function useStatic(receiver: typeof MemberBase, next: number): number { return receiver.run(next); }
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
