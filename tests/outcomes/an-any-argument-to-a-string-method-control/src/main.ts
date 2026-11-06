// run: build
//
// The control for an-any-argument-to-a-string-method: the same `any` values,
// converted with String() before the call, which is the conversion the string
// methods make. It compiles and prints "legonull" and "abcfalsefa", as node
// does.
const missing: any = null;
const fill: any = false;
observe("concat", "lego".concat(String(missing)));
observe("padEnd", "abc".padEnd(10, String(fill)));
done();
