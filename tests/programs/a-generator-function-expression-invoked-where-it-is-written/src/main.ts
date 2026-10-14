// A `function*` expression **invoked where it is written**, which is how every
// test262 `dstr/` case builds its iterator: `var iter = function*() { yield 1; }();`
//
// Its own program rather than an arm beside the named form, because a generator's
// `#call` returns its own frame class and every closure's `#call` overrides one
// dispatch slot, so two generator closures are two frame classes there and the JVM
// refuses them by name. See `a-generator-function-expression`, which says why.

/** Invoked where it is written, which is how test262 spells it. */
export function viaImmediateCall(n: number): number {
  let total = 0;
  for (const value of (function* (): Generator<number> {
    yield 10;
    yield 20;
  })()) {
    total += value;
  }
  return total + n;
}
