/*---
description: Control for members-accessor-getter-only; stored class tags resolve calls to plain functions.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-accessors, ts-this, ts-functions, ts-arrays, ts-errors]
---*/
// Control: the receiver tag selects plain functions with the same effects and log.
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
function baseGet(receiver: MemberBase): number { log.push("Base.get", receiver, receiver.raw); return receiver.raw; }
function baseSet(receiver: MemberBase, next: number): void { log.push("Base.set", receiver, next); receiver.raw = next; }
function readGet(receiver: MemberBase): number { log.push("Read.get", receiver, receiver.raw); return receiver.raw + 10; }
function missingSet(receiver: MemberBase, next: number): void { throw new TypeError("getter-only property"); }
function readMember(receiver: MemberBase): number { return receiver.kind === "base" ? baseGet(receiver) : readGet(receiver); }
function writeMember(receiver: MemberBase, next: number): void {
  if (receiver.kind === "base") baseSet(receiver, next); else missingSet(receiver, next);
}
for (const next of [-2, 0, 5]) for (const receiver of [new MemberBase(), new MemberRead(), new MemberReadLeaf()]) {
  log.length = 0; const writable = receiver.kind === "base";
  if (writable) writeMember(receiver, next); else assert.throws(TypeError, () => writeMember(receiver, next));
  const result = readMember(receiver); const raw = writable ? next : 2;
  assert.sameValue(result, writable ? raw : raw + 10); assert.sameValue(receiver.raw, raw);
  assert.compareArray(log, writable ? ["Base.set", receiver, next, "Base.get", receiver, raw] : ["Read.get", receiver, raw]);
}
