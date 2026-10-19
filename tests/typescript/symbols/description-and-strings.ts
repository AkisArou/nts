/*---
description: A symbol carries its description; String() names it, while implicit string conversion throws TypeError.
features: [ts-symbols, ts-conversions, ts-any]
---*/
const tagged = Symbol("tag");
const bare = Symbol();
assert.sameValue(tagged.description, "tag");
assert.sameValue(bare.description, undefined);
assert.sameValue(String(tagged), "Symbol(tag)");
assert.sameValue(tagged.toString(), "Symbol(tag)");
const loose: any = tagged;
assert.throws(TypeError, () => {
  loose + "";
});
