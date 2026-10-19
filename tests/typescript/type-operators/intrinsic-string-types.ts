/*---
description: Uppercase, Lowercase, Capitalize and Uncapitalize type strings a function computes the same way at run time.
features: [ts-type-operators, ts-template-literal-types]
---*/
function upper<S extends string>(s: S): Uppercase<S> {
  return s.toUpperCase() as Uppercase<S>;
}
function uncap<S extends string>(s: S): Uncapitalize<S> {
  return (s.charAt(0).toLowerCase() + s.slice(1)) as Uncapitalize<S>;
}
const loud: "HELLO" = upper("hello");
const camel: "fooBar" = uncap("FooBar");
assert.sameValue(loud, "HELLO");
assert.sameValue(camel, "fooBar");
