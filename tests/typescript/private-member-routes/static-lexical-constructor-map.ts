/*---
description: A constructor Map keeps lexical static-private access distinct from the dynamic receiver.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-class-fields, ts-inheritance, ts-typeof-type, ts-map-set, ts-tuples, ts-unknown, ts-this, ts-private-fields]
---*/
// LexicalOwner constructors cross Map values; node lets inherited code use the named owner slot while returning the actual subclass receiver.
class LexicalOwner {
  static #value: unknown = undefined;
  static read(): [unknown, object] { return [LexicalOwner.#value, this]; }
  static write(value: unknown): unknown { return LexicalOwner.#value = value; }
}
class LexicalChild extends LexicalOwner {}
class LexicalLeaf extends LexicalChild {}
const constructors = new Map<string, typeof LexicalOwner>([["leaf", LexicalLeaf], ["owner", LexicalOwner], ["child", LexicalChild]]);
const values: unknown[] = [-0, NaN, undefined, "", { id: 1 }];
for (const value of values) {
  for (const key of ["child", "owner", "leaf", "child"]) {
    const receiver = constructors.get(key); if (receiver === undefined) throw new Error("missing constructor");
    assert.sameValue(receiver.write(value), value);
    assert.compareArray(receiver.read(), [value, receiver]);
    assert.compareArray(LexicalOwner.read(), [value, LexicalOwner]);
    assert.compareArray(LexicalChild.read(), [value, LexicalChild]);
    assert.compareArray(LexicalLeaf.read(), [value, LexicalLeaf]);
  }
}
