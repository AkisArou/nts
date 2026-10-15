// **A generator passed to a parameter whose pattern is an array, and the IR
// passes it unconverted.** `skip([,])` takes an iterable, and destructuring
// `[,]` reads one step of it. The prepared HIR declares the parameter as an
// array -- `func skip(arg0: managed<[erased]>)` -- and calls it with the
// generator as it is, `call skip(%1)` where `%1` is a `managed<obj#N>`, with
// nothing between them. The verifier accepts the call.
//
// C agrees with node by luck: a pointer is a pointer, and `skip` never reads
// the array it was promised. The JVM refuses the class at load, `VerifyError:
// Bad type on operand stack` -- the generator's class is not an array -- on
// every case. Test262 has about 43 such cases (`dstr/ary-ptrn-empty`,
// `dstr/ary-ptrn-elision-exhausted`, in functions, methods, generators and
// arrows): 27 crash like this and 16 are refused by the JVM's store check.
//
// The control is `tests/programs/an-array-passed-to-an-array-pattern-parameter`,
// which differs in one thing: the argument is an array.
//
// Found on 2026-10-15 by the JVM lane's first test262 parity run.

function* nothing() {}

function skip([,]) {
  return 1;
}

/** @param {number} n @returns {number} */
export function patternOverAGenerator(n) {
  return skip(nothing()) + n;
}
