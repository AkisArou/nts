/*---
description: Control for members-static-inherited-method-fields; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
class MemberBase {
  static kind: string = "base"; static offset: number = 2; static calls: number = 0;
  static read(next: number): number { log.push("Base.read", this, next, this.offset); this.calls++; return this.offset + next; }
}
class MemberLeft extends MemberBase { static override kind: string = "left"; static override calls: number = 0; }
class MemberRight extends MemberBase {
  static override kind: string = "right"; static override calls: number = 0; static override offset: number = 20;
}
function baseRead(receiver: typeof MemberBase, next: number): number {
  log.push("Base.read", receiver, next, receiver.offset); receiver.calls++; return receiver.offset + next;
}
function useStatic(receiver: typeof MemberBase, next: number): number {
  if (receiver.kind === "base") return baseRead(receiver, next);
  if (receiver.kind === "left") return baseRead(receiver, next);
  return baseRead(receiver, next);
}
const rows = [{ receiver: MemberBase, kind: "base", offset: 2 }, { receiver: MemberLeft, kind: "left", offset: 2 },
  { receiver: MemberRight, kind: "right", offset: 20 }];
for (const next of [-2, 0, 5]) for (const row of rows) {
  log.length = 0; const before = row.receiver.calls; const result = useStatic(row.receiver, next);
  assert.sameValue(row.receiver.kind, row.kind); assert.sameValue(result, row.offset + next);
  assert.sameValue(row.receiver.calls, before + 1); assert.sameValue(row.receiver.offset, row.offset);
  assert.compareArray(log, ["Base.read", row.receiver, next, row.offset]);
}
for (const row of rows) assert.sameValue(row.receiver.calls, 3);
