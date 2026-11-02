/*---
description: A constructor Map keeps lexical static-private access distinct from the dynamic receiver. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-inheritance, ts-typeof-type, ts-map-set, ts-tuples, ts-unknown, ts-this]
---*/
// LexicalOwner constructors cross Map values; node lets inherited code use the named owner slot while returning the actual subclass receiver.
let secret: unknown = undefined;
function readOwner(receiver: object): unknown { if (receiver !== LexicalOwner) throw new TypeError(); return secret; }
function writeOwner(receiver: object, value: unknown): unknown { if (receiver !== LexicalOwner) throw new TypeError(); return secret = value; }
class LexicalOwner {
  static read(): [unknown, object] { return [readOwner(LexicalOwner), this]; }
  static write(value: unknown): unknown { return writeOwner(LexicalOwner, value); }
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
