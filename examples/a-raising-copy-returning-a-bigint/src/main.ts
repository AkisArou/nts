// A function that can throw, called inside a `try`, returning a `bigint`.
//
// Inside a `try` the call goes to the function's raising copy, which tests for a
// raise after each call that can make one and, on that path, returns at once:
// its caller tests the flag first and never reads the value. A `Return` still
// needs an operand of the declared type, and `raised_return` had none for a
// `bigint` -- or for a native pointer -- under a comment calling both
// unreachable. So the copy ended in a bare `ret`, `ReturnType { found: None }`,
// and the whole program was invalid HIR.
//
// The native-pointer half is the one that was found: the GTK corpus harness's
// recursive `firstButton(widget): GtkButton | null`, reached from a signal
// handler, broke 56 of the corpus's 59 programs. It needs GTK to run, so it is
// not here; this is the same arm through the type node can run.
//
// What each export pins:
//
//   factorial   a recursive raising copy returning a `bigint`, and its throw
//               reaching the handler for a negative argument
//
// Transcribed from node (v24), called with 5 and -3:
//
//     factorial(5) 120    factorial(-3) -1
function factorialOf(n: bigint): bigint {
  if (n < 0n) throw new RangeError("negative");
  return n === 0n ? 1n : n * factorialOf(n - 1n);
}

export function factorial(n: number): number {
  try {
    return Number(factorialOf(BigInt((n | 0) % 15)) % 1000007n);
  } catch (e) {
    return e instanceof RangeError ? -1 : -2;
  }
}
