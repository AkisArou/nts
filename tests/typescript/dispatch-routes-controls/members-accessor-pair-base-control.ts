/*---
description: Control for members-accessor-pair-base; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-accessors, ts-this, ts-functions, ts-arrays]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
const log: unknown[] = [];
class MemberBase {
  kind: string = "base"; raw: number = 2;
  get value(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set value(next: number) { log.push("Base.set", this, next); this.raw = next; }
}
class MemberPlus extends MemberBase {
  override kind: string = "plus"; extra: string = "plus";
  override get value(): number { log.push("Plus.get", this, this.raw); return this.raw + 10; }
  override set value(next: number) { log.push("Plus.set", this, next); this.raw = next + 1; }
}
class MemberTimes extends MemberBase {
  padding: boolean = true; override kind: string = "times";
  override get value(): number { log.push("Times.get", this, this.raw); return this.raw * 2; }
  override set value(next: number) { log.push("Times.set", this, next); this.raw = next * 3; }
}
function baseGet(receiver: MemberBase): number { log.push("Base.get", receiver, receiver.raw); return receiver.raw; }
function baseSet(receiver: MemberBase, next: number): void { log.push("Base.set", receiver, next); receiver.raw = next; }
function plusGet(receiver: MemberBase): number { log.push("Plus.get", receiver, receiver.raw); return receiver.raw + 10; }
function plusSet(receiver: MemberBase, next: number): void { log.push("Plus.set", receiver, next); receiver.raw = next + 1; }
function timesGet(receiver: MemberBase): number { log.push("Times.get", receiver, receiver.raw); return receiver.raw * 2; }
function timesSet(receiver: MemberBase, next: number): void { log.push("Times.set", receiver, next); receiver.raw = next * 3; }
function useMember(receiver: MemberBase, value: number): number {
  if (receiver.kind === "base") { baseSet(receiver, value); return baseGet(receiver); }
  if (receiver.kind === "plus") { plusSet(receiver, value); return plusGet(receiver); }
  timesSet(receiver, value); return timesGet(receiver);
}
for (const value of [-2, 0, 5]) {
  const rows = [{ receiver: new MemberBase(), kind: "base", label: "Base", raw: value, result: value },
    { receiver: new MemberPlus(), kind: "plus", label: "Plus", raw: value + 1, result: value + 11 },
    { receiver: new MemberTimes(), kind: "times", label: "Times", raw: value * 3, result: value * 6 }];
  for (const row of rows) {
    log.length = 0; const receiver: MemberBase = row.receiver; const result = useMember(receiver, value);
    assert.sameValue(receiver.kind, row.kind); assert.sameValue(result, row.result); assert.sameValue(receiver.raw, row.raw);
    assert.compareArray(log, [row.label + ".set", receiver, value, row.label + ".get", receiver, row.raw]);
  }
}
