/*---
description: A setter-only override hides the inherited getter and preserves super setter effects through a base view.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-accessors, ts-this, ts-functions, ts-arrays, ts-unions]
---*/
// Route: MemberBase holds Base, Write or WriteLeaf; subclass writes reach Write then Base, while subclass reads return undefined.
const log: unknown[] = [];
class MemberBase {
  kind: string = "base"; raw: number = 2;
  get value(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set value(next: number) { log.push("Base.set", this, next); this.raw = next; }
}
class MemberWrite extends MemberBase {
  override kind: string = "write";
  override set value(next: number) { log.push("Write.set", this, next); super.value = next + 10; }
}
class MemberWriteLeaf extends MemberWrite { override kind: string = "leaf"; padding: string = "leaf"; }
function useMember(receiver: MemberBase, next: number): number | undefined { receiver.value = next; return receiver.value; }
for (const next of [-2, 0, 5]) for (const receiver of [new MemberBase(), new MemberWrite(), new MemberWriteLeaf()]) {
  log.length = 0; const base = receiver.kind === "base"; const result = useMember(receiver, next);
  assert.sameValue(result, base ? next : undefined); assert.sameValue(receiver.raw, base ? next : next + 10);
  assert.compareArray(log, base ? ["Base.set", receiver, next, "Base.get", receiver, next] :
    ["Write.set", receiver, next, "Base.set", receiver, next + 10]);
}
