// run: build
//
// `isO.bind(o)` makes a function whose `this` is `o`, so calling it answers
// true, as node prints. nts compiles the program and answers false: the bound
// function runs without the receiver `bind` gave it. test262
// language/function-code/10.4.3-1-77gs and 10.4.3-1-79gs (a strict function
// called through `bind(null)` and `bind(someObject)`) answer wrong the same way
// in the census of 2026-11-06 on pin e0395d27506b. The control,
// a-bound-function-reads-its-bound-this-control, passes the same receiver with
// `call` and agrees. The receiver is an object, not null, so the answer does
// not depend on whether the oracle runs the module in strict mode.
const o = {};
function isO(this: unknown): boolean { return this === o; }
observe("bound", String(isO.bind(o)()));
done();
