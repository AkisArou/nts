/*---
description: An inherited static method reads inherited or shadowed fields from each actual constructor receiver.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Route: typeof MemberBase holds Base, Left or Right; inherited Base.read uses that constructor and its own offset and call count.
const log: unknown[] = [];
class MemberBase {
  static kind: string = "base"; static offset: number = 2; static calls: number = 0;
  static read(next: number): number { log.push("Base.read", this, next, this.offset); this.calls++; return this.offset + next; }
}
class MemberLeft extends MemberBase { static override kind: string = "left"; static override calls: number = 0; }
class MemberRight extends MemberBase {
  static override kind: string = "right"; static override calls: number = 0; static override offset: number = 20;
}
function useStatic(receiver: typeof MemberBase, next: number): number { return receiver.read(next); }
const rows = [{ receiver: MemberBase, kind: "base", offset: 2 }, { receiver: MemberLeft, kind: "left", offset: 2 },
  { receiver: MemberRight, kind: "right", offset: 20 }];
for (const next of [-2, 0, 5]) for (const row of rows) {
  log.length = 0; const before = row.receiver.calls; const result = useStatic(row.receiver, next);
  assert.sameValue(row.receiver.kind, row.kind); assert.sameValue(result, row.offset + next);
  assert.sameValue(row.receiver.calls, before + 1); assert.sameValue(row.receiver.offset, row.offset);
  assert.compareArray(log, ["Base.read", row.receiver, next, row.offset]);
}
for (const row of rows) assert.sameValue(row.receiver.calls, 3);
