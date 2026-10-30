// expect: NTS1100 `Date.now` (es:Date) is not provided by this compiler: it reads a clock, which no differential could check
//
// A clock read has no shared input instant across separate executions.
// The one-difference control replaces this read with a fixed instant:
// tests/programs/a-fixed-instant-in-place-of-date-now.
export function rightNow(n: number): number {
  return Date.now() + n;
}
