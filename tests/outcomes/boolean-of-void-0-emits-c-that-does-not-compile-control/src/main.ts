// run: build
//
// The control for boolean-of-void-0-emits-c-that-does-not-compile: the same
// call given `undefined` instead of `void 0`. It compiles and prints false, as
// node does.
observe("void 0", String(Boolean(undefined)));
done();
