// A computed accessor name that is a numeric literal is the property named by that
// number's *string*: `get [0x10]()` defines "16", and `obj['16']` reaches it. nts
// answers otherwise for every spelling test262 tries -- hex, binary, octal,
// exponent, leading decimal, non-canonical -- and for object literals, class
// statics and class declarations alike -- and not only accessors: a computed
// *method* `[0x10]()` loses its reading statement the same way, and a computed
// class *field* `[0x10] = ...` segfaults (a-numeric-computed-field-name). The
// decimal spelling of each agrees with node. 18 test262 cases under
// {expressions,statements}/class/accessor-name-static/literal-numeric-* and
// expressions/object/accessor-name-literal-numeric-*. No diagnostic. Found by the
// first census after the stand-in harness took a generic sameValue.
//
// **The cause (diagnosed by the compiler lane):** a numeric literal carries its raw
// source text (ast.rs, rightly, for values), and `literal_name` returns that text
// for a computed *name* -- `"0x10"` -- while every read of the member looks up
// ECMAScript's ToString of the value, `"16"`. One name in the layout, another in
// the lookup: an accessor or method read finds nothing and its statement is
// dropped, a field reaches a slot that is not there. Formatting cases the fix must
// also get right are pinned in numeric-computed-keys-where-formatting-can-disagree.
var stringSet: string | undefined;
var obj = {
  get [0x10]() { return "get string"; },
  set [0x10](param: string) { stringSet = param; },
};
observe("get", String(obj["16"]));
obj["16"] = "set string";
observe("set", String(stringSet));
var decimal = {
  get [16]() { return "decimal"; },
};
observe("decimal", String(decimal["16"]));
var method = {
  [0x10]() { return "method"; },
};
observe("method", String(method["16"]()));
observe("after", "reached");
done();
