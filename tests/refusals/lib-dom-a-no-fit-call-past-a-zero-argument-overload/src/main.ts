// expect: emit-c --rc -> emits-c nts_dom_new_DashStream_1(
//
// A call no overload fits, beside a zero-argument overload declared
// first and a lent array second (src/source.d.ts models the binding):
// the argument is no array, so the lent candidate cannot take it, and
// its `pull` is a member of the checked dictionary the record has no
// field for, so the record does not fit it either. What answers for
// the call is the fallback `shortest_fit` makes so coercion can speak,
// and that fallback must still respect the argument count: the
// zero-argument candidate is not at min(maxarg, 1) and is never an
// answer for a one-argument call. Without the count, its empty
// parameter list passed every per-parameter test vacuously, the call
// was taken by it, and only the dropped-argument refusal further down
// stopped the argument vanishing. With it, the record answers, as for
// any object argument a lent array may not answer for. The fit side
// of `pull` is the pair
// a-lib-dom-method-for-a-dictionary-member-its-binding-has-no-field-for{,-control};
// this pins only the arity.
class Source {
  gap = 4;
  pull(): number {
    return 1;
  }
}

export function probe(): void {
  new DashStream(new Source());
}
