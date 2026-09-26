// A runtime refusal that aborts: `nts: refused: index 1 is outside [0, 1)`, SIGABRT.
// `[...[x, y]]` over a one-element array must leave `y` undefined. Found by
// test262's statements/for-of/dstr/array-rest-nested-array-null.js.
var x, y;
for ([...[x, y]] of [[null]]) {
  observe("x", String(x));
  observe("y", String(y));
}
done();
