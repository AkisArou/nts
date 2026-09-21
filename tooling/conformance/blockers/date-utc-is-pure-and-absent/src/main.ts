// expect: NTS1001 `Date.UTC`, which is a pure function of its arguments
//
// **Not a clock**, which is the whole reason this has a fixture of its own.
//
// `Date.now` and `new Date()` are refused on principle: they read a wall clock
// this runtime has no capability for, and no differential could check one if
// it had it. `lower_new_date` says exactly that, and `Date.now` now says it
// too.
//
// `Date.UTC(2020, 0, 1)` is a pure function of its arguments -- year, month,
// day, and optionally the time parts -- returning a millisecond offset from
// the epoch. Running it twice gives the same answer, and node's answer is
// checkable against ours the way every other arithmetic helper is.
//
// So it is **absent rather than impossible**, and grouped under the clock it
// would read as refused on principle and nobody would look again. Two sites in
// `runtime/node`.
//
// # What it needs
//
// Civil-date arithmetic: days-from-civil for the year/month/day, then the time
// parts in milliseconds. The runtime holds a date as "a millisecond offset
// from the epoch, and nothing else", so there is nowhere to put it today --
// `nts_date_new(double ms)` takes the answer rather than computing it.
//
// The neighbouring refusals say why the *local* getters cannot follow: they
// read a local calendar and would need a timezone database. `Date.UTC` needs
// none, which is what makes it the tractable one in the family.

export function epochOf(n: number): number {
  return Date.UTC(2020, 0, 1 + (n - n));
}
