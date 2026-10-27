// run: check
// A finite argument reaches the base case; NaN never does. Node throws a
// catchable RangeError at its stack limit. A native signal cannot be caught.
function fib(n: number): number {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
function attempt(n: number): number {
  try { fib(n); return 0; } catch { return 1; }
}
export function control(): number { return attempt(1); }
export function subject(): number { return attempt(NaN); }
