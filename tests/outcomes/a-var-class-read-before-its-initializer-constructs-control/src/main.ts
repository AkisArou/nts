// run: check
//
// The control for a-var-class-read-before-its-initializer-constructs: `C` is
// assigned before `make()` first runs, so `new C()` constructs in node too
// and `early` is 7.
function make(): number {
  return new C().v;
}
var C = class {
  v = 7;
};
let early = 0;
try {
  early = make();
} catch {
  early = -1;
}
export function probe(n: number): number {
  return early * 10 + make() + n;
}
