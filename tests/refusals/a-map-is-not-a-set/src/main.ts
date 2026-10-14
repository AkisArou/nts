// expect: emit-c -> emits-c nts_is_set
//
// `instanceof Map` and `instanceof Set`, and the property that matters is that
// they **disagree**. One struct serves both -- a Set is a Map that holds no
// values -- so the descriptor alone cannot tell them apart and `holds_values`
// is the whole of the difference.
//
// Written in the runtime as one predicate and its negation rather than two
// independent tests, because two could drift into both answering true, which is
// a wrong answer rather than a refusal.
//
// **That was not hypothetical.** The JVM lane's `newMap` and `newSet` both
// returned a bare `NtsMap` and dropped the kind they were handed, so a Set was
// a Map and nothing had ever asked which. They found it while writing their
// half, before either half landed, and held the batch -- which is the only
// reason this is a fixture about correct behaviour rather than a record about a
// silent wrong answer behind a green gate. No example exercised it.
//
// Verified by running it, and the assertion is arithmetic so a partial answer
// cannot look like a whole one: `run()` is **120** exactly when the map says
// Map, the set says Set, and a string says neither. Two predicates that both
// answered true would give 110; two that both answered false, 0.
//
// A `Map` and a `Set` also had to become erasable to be asked about at all --
// a predicate that cannot take a constructed value is half a feature, which is
// what `DataView` was until the same evening. `the_two_erasure_lists_agree`
// holds `erasable` against `erased_tag` so that half cannot go missing again.

function describe(value: unknown): number {
  if (value instanceof Map) return 1;
  if (value instanceof Set) return 2;
  return 0;
}

export function run(): number {
  const map = new Map<string, number>();
  const set = new Set<number>();
  return describe(map) * 100 + describe(set) * 10 + describe("x");
}
