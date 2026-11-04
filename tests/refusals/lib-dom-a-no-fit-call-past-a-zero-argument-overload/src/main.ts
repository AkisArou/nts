// expect: emit-c --rc -> NTS1001 an opaque C pointer converted to a different representation is not supported by this lowering yet
//
// A call no overload fits, beside a zero-argument overload declared
// first and a lent array second (src/source.d.ts models the binding):
// the argument is an opaque handle, so the lent candidate cannot take
// it and no record holds it. What answers for the call is the
// fallback `shortest_fit` makes so coercion can name what it cannot
// carry, and that fallback must still respect the argument count: the
// zero-argument candidate is not at min(maxarg, 1) and is never an
// answer for a one-argument call. Without the count, its empty
// parameter list passed every per-parameter test vacuously, the call
// was taken by it, and the refusal named a dropped argument instead
// of the conversion that cannot carry the handle. With it, the
// record answers and refuses as any record read of a handle does
// (a-lib-dom-object-read-as-a-union-dictionary-arm, whose radii list
// is this shape with real overloads). This pins only the arity.
export function probe(): void {
  new DashStream(new DOMPointReadOnly(1, 2));
}
