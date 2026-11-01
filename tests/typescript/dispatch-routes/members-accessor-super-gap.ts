/*---
description: Accessor super calls pass through a non-overriding level without skipping the middle implementation.
features: [ts-dispatch-route-accessors-statics, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-accessors, ts-this, ts-functions, ts-arrays]
---*/
// Route: MemberBase holds Middle, Gap or Leaf; Leaf super skips the empty level but enters Middle then Base on the same receiver.
const log: unknown[] = [];
class MemberBase {
  kind: string = "base"; raw: number = 2;
  get value(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set value(next: number) { log.push("Base.set", this, next); this.raw = next; }
}
class MemberMiddle extends MemberBase {
  override kind: string = "middle";
  override get value(): number { log.push("Middle.get", this); return super.value + 10; }
  override set value(next: number) { log.push("Middle.set", this, next); super.value = next + 1; }
}
class MemberGap extends MemberMiddle { override kind: string = "gap"; padding: string = "gap"; }
class MemberLeaf extends MemberGap {
  override kind: string = "leaf";
  override get value(): number { log.push("Leaf.get", this); return super.value + 100; }
  override set value(next: number) { log.push("Leaf.set", this, next); super.value = next * 2; }
}
function useMember(receiver: MemberBase, value: number): number { receiver.value = value; return receiver.value; }
for (const value of [-2, 0, 5]) for (const receiver of [new MemberMiddle(), new MemberGap(), new MemberLeaf()]) {
  log.length = 0; const leaf = receiver.kind === "leaf"; const passed = leaf ? value * 2 : value;
  const result = useMember(receiver, value); const expected: unknown[] = [];
  if (leaf) expected.push("Leaf.set", receiver, value);
  expected.push("Middle.set", receiver, passed, "Base.set", receiver, passed + 1);
  if (leaf) expected.push("Leaf.get", receiver);
  expected.push("Middle.get", receiver, "Base.get", receiver, passed + 1);
  assert.sameValue(result, passed + (leaf ? 111 : 11)); assert.sameValue(receiver.raw, passed + 1);
  assert.compareArray(log, expected);
}
