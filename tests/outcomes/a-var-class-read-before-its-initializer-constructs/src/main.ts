// run: check
//
// `make()` runs at module scope before `var C = class {...}` has assigned
// `C`, so node's `new C()` throws a TypeError (`C` is `undefined`) and `early`
// is -1. nts treats `C` as settled from its one assignment and constructs,
// so `early` is 7: settlement must hold only for the reads its initializer
// dominates. The control declares `C` before the call and agrees.
function make(): number {
  return new C().v;
}
let early = 0;
try {
  early = make();
} catch {
  early = -1;
}
var C = class {
  v = 7;
};
export function probe(n: number): number {
  return early * 10 + make() + n;
}
