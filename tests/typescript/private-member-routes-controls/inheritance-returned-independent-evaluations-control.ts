/*---
description: A Map-backed control: Two evaluations may stamp the same returned object with separate private names while each evaluation rejects its own duplicate stamp.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-class-expression, ts-functions, ts-tuples, ts-inheritance, ts-unknown, ts-static, ts-map-set]
---*/
// Stamp targets travel through an object tuple; node admits one brand from each class evaluation on one object, then rejects each repeated evaluation stamp. The control uses guarded Maps with the same observations.
class ReturnTarget { constructor(target: object) { return target; } }
function stampFamily(initial: unknown) {
  const values = new Map<object, unknown>();
  return class Stamp extends ReturnTarget {
    constructor(target: object) { super(target); if (values.has(this)) throw new TypeError(); values.set(this, initial); }
    static owns(target: object): boolean { return values.has(target); }
    static read(target: Stamp): unknown { if (!values.has(target)) throw new TypeError(); return values.get(target); }
    static write(target: Stamp, value: unknown): unknown { if (!values.has(target)) throw new TypeError(); values.set(target, value); return value; }
  };
}
for (const value of [-0, undefined, { value: 1 }]) {
  const next = { value }, replacement = { next }, First = stampFamily(value), Second = stampFamily(next);
  const targets: [object, object, object] = [{ label: "same" }, { label: "same" }, []];
  for (const target of targets) {
    assert.sameValue(First.owns(target), false); assert.sameValue(Second.owns(target), false);
    const first = new First(target);
    assert.sameValue(first, target); assert.sameValue(First.owns(target), true); assert.sameValue(Second.owns(target), false);
    const second = new Second(target);
    assert.sameValue(second, target); assert.sameValue(first, second);
    assert.sameValue(First.owns(target), true); assert.sameValue(Second.owns(target), true);
    assert.sameValue(First.read(second), value); assert.sameValue(Second.read(first), next);
    assert.sameValue(First.write(second, replacement), replacement); assert.sameValue(First.read(first), replacement); assert.sameValue(Second.read(first), next);
    assert.throws(TypeError, () => new First(target)); assert.throws(TypeError, () => new Second(target));
    assert.sameValue(First.read(first), replacement); assert.sameValue(Second.read(second), next);
  }
}
