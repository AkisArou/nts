// run: build
//
// The control for an-object-literal-with-an-empty-property-name: the same
// literal with its first field named `b` instead of "". It compiles and prints
// 1 and 2, as node does.
const o = { b: 1, a: 2 };
observe("empty", String(o["b"]));
observe("a", String(o.a));
done();
