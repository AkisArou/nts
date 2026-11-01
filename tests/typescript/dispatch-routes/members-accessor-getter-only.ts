/*---
description: A getter-only override hides the inherited setter even through a writable base-class view.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-accessors, ts-this, ts-functions, ts-arrays, ts-errors]
---*/
// Route: MemberBase holds Base, Read or ReadLeaf; writes to the getter-only subclasses throw and their reads keep the original raw value.
const log: unknown[] = [];
class MemberBase {
  kind: string = "base"; raw: number = 2;
  get value(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set value(next: number) { log.push("Base.set", this, next); this.raw = next; }
}
class MemberRead extends MemberBase {
  override kind: string = "read";
  override get value(): number { log.push("Read.get", this, this.raw); return this.raw + 10; }
}
class MemberReadLeaf extends MemberRead { override kind: string = "leaf"; padding: boolean = true; }
function readMember(receiver: MemberBase): number { return receiver.value; }
function writeMember(receiver: MemberBase, next: number): void { receiver.value = next; }
for (const next of [-2, 0, 5]) for (const receiver of [new MemberBase(), new MemberRead(), new MemberReadLeaf()]) {
  log.length = 0; const writable = receiver.kind === "base";
  if (writable) writeMember(receiver, next); else assert.throws(TypeError, () => writeMember(receiver, next));
  const result = readMember(receiver); const raw = writable ? next : 2;
  assert.sameValue(result, writable ? raw : raw + 10); assert.sameValue(receiver.raw, raw);
  assert.compareArray(log, writable ? ["Base.set", receiver, next, "Base.get", receiver, raw] : ["Read.get", receiver, raw]);
}
