/*---
description: A Map-backed control: Different instantiations of one generic class share its private brands while retaining independent generic payloads and numeric revisions.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-generics, ts-functions, ts-tuples, ts-unknown, ts-static, ts-strings, ts-map-set]
---*/
// RevisionBox<T> instances cross one generic parameter route at string and object instantiations; node shares the brands but changes only the selected private payload and revision. The control uses guarded Maps with the same observations.
const revisions = new Map<object, number>(), payloads = new Map<object, unknown>();
class RevisionBox<T> {
  constructor(payload: T, revision: number) { payloads.set(this, payload); revisions.set(this, revision); }
  payload(): unknown { if (!payloads.has(this)) throw new TypeError(); return payloads.get(this); }
  replace(payload: T): unknown { if (!payloads.has(this)) throw new TypeError(); payloads.set(this, payload); return payload; }
  revision(): number { if (!revisions.has(this)) throw new TypeError(); const value = revisions.get(this); if (value === undefined) throw new TypeError(); return value; }
  advance(): number { const next = this.revision() + 1; if (!revisions.has(this)) throw new TypeError(); revisions.set(this, next); return next; }
  static owns(value: object): boolean { return revisions.has(value); }
}
function exercise<T>(box: RevisionBox<T>, payload: T, next: T, revision: number): void {
  assert.sameValue(box.payload(), payload); assert.sameValue(box.revision(), revision);
  assert.sameValue(RevisionBox.owns(box), true); assert.sameValue(box.advance(), revision + 1);
  assert.sameValue(box.replace(next), next); assert.sameValue(box.payload(), next);
  assert.sameValue(box.revision(), revision + 1);
}
for (const value of [-0, 3, 20]) {
  const payload = { value }, label = "box" + value;
  const pair: [RevisionBox<string>, RevisionBox<object>] = [new RevisionBox(label, value), new RevisionBox(payload, value + 5)];
  exercise(pair[0], label, label + "next", value); assert.sameValue(pair[1].revision(), value + 5); assert.sameValue(pair[1].payload(), payload);
  exercise(pair[1], payload, { value: value + 1 }, value + 5); assert.sameValue(pair[0].revision(), value + 1); assert.sameValue(pair[0].payload(), label + "next");
  assert.sameValue(RevisionBox.owns({ payload: label }), false);
  assert.sameValue(RevisionBox.owns({ payload }), false);
}
