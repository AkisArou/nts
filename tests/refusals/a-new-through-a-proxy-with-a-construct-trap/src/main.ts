// expect: NTS1001 a `new` that does not produce an object is not supported by this lowering yet
//
// A `new` through a proxy whose handler has a `construct` trap. node runs the
// trap, so `new Trapped(4)` is the trap's `[7, 8, 9]` and `probe(19)` is 31.
// Main built an `Array` from the site's type and ignored the proxy: 40, and
// 29 of 29 cases wrong. Construction goes by what the callee references now,
// and a proxy references no constructor this compiler builds, so the `new` is
// refused by name until proxies are built whole (in scope, deferred). The
// control, programs/a-new-through-a-proxy-with-a-construct-trap-control, makes
// the same `new` through a constant alias of `Array` and agrees.
const Trapped = new Proxy(Array, { construct() { return [7, 8, 9]; } });
export function probe(n: number): number {
  const made = new Trapped((n & 3) + 1);
  return made.length * 10 + (made[0] === 7 ? 1 : 0);
}
