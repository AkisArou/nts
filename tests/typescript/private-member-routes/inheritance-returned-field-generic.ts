/*---
description: A returning base lets a derived private field stamp the exact generic target and rejects stamping the same target twice.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-generics, ts-generic-constraints, ts-functions, ts-inheritance, ts-unknown, ts-instanceof, ts-static, ts-private-fields]
---*/
// FieldStamp returns through an object-constrained generic helper; node adds the field to the original object, preserves aliases, and throws on a second stamp without changing its value.
class ReturnTarget { constructor(target: object) { return target; } }
class FieldStamp extends ReturnTarget {
  #value: unknown = 7;
  static owns(target: object): boolean { return #value in target; }
  static read(target: FieldStamp): unknown { return target.#value; }
  static write(target: FieldStamp, value: unknown): unknown { return target.#value = value; }
}
function stamp<T extends object>(target: T): FieldStamp { return new FieldStamp(target); }
class StampTarget { label: string = "same"; }
const first = { label: "same" }, equal = { label: "same" }, targets: object[] = [first, equal, [], () => 7, new StampTarget()];
assert.notSameValue(first, equal);
for (const target of targets) {
  const alias: object = target, next = { target };
  assert.sameValue(FieldStamp.owns(target), false);
  const result = stamp(target);
  assert.sameValue(result, target); assert.sameValue(FieldStamp.owns(alias), true); assert.sameValue(result instanceof FieldStamp, false);
  assert.sameValue(FieldStamp.read(result), 7); assert.sameValue(FieldStamp.write(result, next), next);
  assert.sameValue(FieldStamp.read(result), next); assert.throws(TypeError, () => stamp(alias));
  assert.sameValue(FieldStamp.owns(alias), true); assert.sameValue(FieldStamp.read(result), next);
}
