// A computed accessor name that is a numeric literal is the property named by that
// number's *string*: `get [0x10]()` defines "16", and `obj['16']` reaches it. nts
// answers otherwise for every spelling test262 tries -- hex, binary, octal,
// exponent, leading decimal, non-canonical -- and for object literals, class
// statics and class declarations alike: 18 test262 cases under
// {expressions,statements}/class/accessor-name-static/literal-numeric-* and
// expressions/object/accessor-name-literal-numeric-*. No diagnostic. Found by the
// first census after the stand-in harness took a generic sameValue.
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
done();
