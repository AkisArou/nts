// `s.at(i)`.
//
// **Three spellings and three answers for an index that is not there**, and the
// language means a different one each time: `charAt` gives `""`, `s[i]` stops
// the program the way an out-of-range array index does, and `at` gives
// `undefined` — the null pointer, which is what a `string | undefined` is. `at`
// is also the only one of the three that counts a negative index from the end,
// which is why the method exists.
//
// The relative index is one rule over two containers, so `nts_relative_offset`
// is now shared with `nts_array_offset` rather than written twice.
//
// **The C declaration is `NTS_ALLOCATES_OR_NULL`, and that is the whole
// subtlety.** `NTS_ALLOCATES` carries `returns_nonnull`, and that macro's own
// comment says what it costs: "a promise to the optimiser, and a caller's null
// check is dead code the moment the promise is made". `-Werror` rejects the
// `return NULL` outright, which is the loud half. The quiet half would have been
// a `??` compiled away and an `undefined` that never arrives.

export function first(s: string): string {
  return s.at(0) ?? "-";
}

/** The reason the method exists: a negative index from the end. */
export function last(s: string): string {
  return s.at(-1) ?? "-";
}

export function pastTheEnd(s: string): string {
  return s.at(99) ?? "-";
}

export function beforeTheStart(s: string): string {
  return s.at(-99) ?? "-";
}

/** A fractional index, which `ToIntegerOrInfinity` truncates. */
export function fractional(s: string): string {
  return s.at(1.7) ?? "-";
}

/** Returned as it is, so `undefined` crosses the export boundary rather than
 *  being consumed by a `??` inside. */
export function asOptional(s: string): string | undefined {
  return s.at(99);
}

/** The three spellings beside each other, which is the point: `charAt` answers
 *  `""` where `at` answers `undefined`, and a fixture that used only one of them
 *  could not tell a wrong answer from the right one. */
export function threeSpellings(s: string): string {
  return s.charAt(99) + "|" + (s.at(99) ?? "undef") + "|" + s.charAt(0);
}
