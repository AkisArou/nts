// Calls that matched an overload signature, in a loop.
//
// An overload set is erased before anything is emitted: TypeScript picks a
// signature, and the call is built against the *implementation* beside it. So
// an overloaded call and an ordinary one to the same function are the same
// call, and this is the instrument that says so — a lowering that boxed the
// omitted argument, gathered an arguments object, or built a per-call record to
// choose between the signatures would show up here and nowhere else, because
// the answers would stay right either way.
//
// Free functions only, deliberately. A receiver would make the numbers about
// escape analysis rather than about overloads.
//
// The **rest** overload is not here. Its empty array per call is one allocation
// each, and record 0092 measured that exact shape at 17/17 with a floor of zero
// that cannot be reached: `ArrayNew` carries no `frame` flag, so an array is a
// heap object in this compiler however plainly it dies with the call that made
// it. Neither number could be written here honestly.

// An optional parameter, which is erased and carries a tag. The call written
// with two arguments matches `(a, b)`, whose `b` is a bare `f64`; the slot it
// is going into is `Erased`.
function pick(a: number): number;
function pick(a: number, b: number): number;
function pick(a: number, b?: number): number {
  return b === undefined ? a : (a + b) | 0;
}

// A **default** rather than an optional. The omitted argument is an expression
// evaluated at the call, which is a different path and also allocates nothing.
function scaled(a: number): number;
function scaled(a: number, by: number): number;
function scaled(a: number, by = 3): number {
  return (a * by) | 0;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    total = (total + pick(i)) | 0;
    total = (total + pick(i, 2)) | 0;
    total = (total + scaled(i)) | 0;
    total = (total + scaled(i, 2)) | 0;
  }
  return total;
}
