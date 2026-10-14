// A logical assignment whose test keeps the value, so the right operand is
// never evaluated.
//
// `width ||= ("grown" + i).length` is not `width = width || ("grown" +
// i).length`. The desugaring builds a string on every iteration and throws it
// away; the operator builds none, because the right operand of `||=` is
// evaluated only on the path that writes.
//
// The difference exists only at run time -- the arm is compiled and reachable
// either way -- which is what this suite measures and what the benchmark table
// cannot separate from everything else going on in a loop.
//
// `width` is `8 + n` rather than a literal so the test is a real one: the
// compiler does not know `n`, cannot fold the truthiness, and cannot delete the
// arm. At run time it is the loop bound, so it is positive whenever the loop
// runs at all, and the arm never executes.

export function work(n: number): number {
  let total = 0;
  let width = 8 + n;
  for (let i = 0; i < 8 + n; i++) {
    width ||= ("grown" + i).length;
    total = total + width;
  }
  return total;
}
