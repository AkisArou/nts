// run: build
//
// The control for a-bigint-bitwise-not-stops-the-build: the same bigint under
// unary minus instead of `~`. It compiles and prints -5, as node does.
const a: bigint = 5n;
observe("not", String(-a));
done();
