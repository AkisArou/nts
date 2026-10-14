// A counter that starts at a parameter, and what its class is allowed.
//
// Nothing here is a fix. This is a *shape* no other example has, kept because
// it is the reproduction for a gap that is open -- and because it agrees with
// node on every case, which is worth having whatever the compiler does with it.
//
// `guards` and `signatures` do their work: an exported `f(offset: number)` gets
// a `#whole` variant whose parameter really is an `i32`. Then `specialize`
// joins the counter to whatever the entry edge carries into the loop's block
// parameter, and the class is specialized only if every member is provably an
// integer.
//
// For `pastInt32` it is not. `at` starts at a parameter and stops at
// `offset + maximum`, which is parameter-derived, and an interval domain
// widens a counter with no constant bound straight to infinity:
//
//     inputIndex-like   i32  [0, 2147483647] whole      <- bounded by a length
//     at                f64  [-inf, +inf] nan? -0?      <- bounded by a parameter
//
// So the counter is a double: a floating-point comparison per iteration,
// floating-point arithmetic on an integer quantity, and a truncation at every
// use that reads it as one. `withinInt32` is the same loop with a constant
// bound and it narrows, which is what says the gap is the *proof* rather than
// the shape.
//
// `flow::Analysis` already keeps the relation this needs -- pairs `(a, b)`
// where `a < b` holds throughout a block -- and its own comment says why:
// "an index is inside an array whose length is unknown... the identity of the
// value that guards the loop is the whole of the proof". That machinery is
// consulted for bounds checks and not for representation. See
// `docs/records/0213`.
//
// The four functions differ in what the counter's class can be proved to want,
// and they are here together because the gap is only visible as the difference
// between them.

// Unprovable: `at` is bounded by `offset + maximum`, which is itself derived
// from parameters, so no interval bounds it. This is the counter that is a
// double.
export function pastInt32(offset: number, maximum: number): number {
  const end = offset + maximum;
  let at = offset;
  let sum = 0;
  let steps = 0;
  while (at < end && steps < 32) {
    sum = sum + (at & 0xff);
    at = at + 1;
    steps = steps + 1;
  }
  return sum;
}

// Provable: a constant bound, so the interval closes and the counter is an
// integer. The control -- same loop, same parameter, one difference.
export function withinInt32(offset: number): number {
  let at = offset;
  let sum = 0;
  let steps = 0;
  while (at < 1000 && steps < 32) {
    sum = sum + (at & 0xff);
    at = at + 1;
    steps = steps + 1;
  }
  return sum;
}

// A coercion between the parameter and the counter. `| 0` is a fresh value
// whose result is `int32` by the language's own definition rather than by
// inference, which is the one way a program can say what the analysis cannot
// prove -- and it is why `x | 0` is the idiom for "this is an integer".
export function throughCoercion(offset: number, maximum: number): number {
  const end = offset + maximum;
  let at = offset | 0;
  let sum = 0;
  let steps = 0;
  while (at < end && steps < 32) {
    sum = sum + (at & 0xff);
    at = at + 1;
    steps = steps + 1;
  }
  return sum;
}

// Counting downward, so the increment is a subtraction and the comparison the
// other way round. A gap stated for one direction is a gap checked in one
// direction.
export function downward(offset: number, maximum: number): number {
  const floor = offset - maximum;
  let at = offset;
  let sum = 0;
  let steps = 0;
  while (at > floor && steps < 32) {
    sum = sum + (at & 0xff);
    at = at - 1;
    steps = steps + 1;
  }
  return sum;
}
