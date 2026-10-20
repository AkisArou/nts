// **A generator passed to a parameter whose pattern is an array, and the IR
// passes it unconverted.** `skip([,])` takes an iterable, and destructuring
// `[,]` reads one step of it. The prepared HIR declares the parameter as an
// array -- `func skip(arg0: managed<[erased]>)` -- and calls it with the
// generator as it is, `call skip(%1)` where `%1` is a `managed<obj#N>`, with
// nothing between them. The verifier accepts the call.
//
// C agrees with node by luck: a pointer is a pointer, and `skip` never reads
// the array it was promised. The JVM refuses the store by name, "storing an
// object where an array of erased values is declared" -- an object type and
// an array are classes neither of which extends the other. It was a
// `VerifyError` at load until the backend's store check learned that pair,
// which took the whole program class with it. Test262 has about 43 such cases
// (`dstr/ary-ptrn-empty`, `dstr/ary-ptrn-elision-exhausted`, in functions,
// methods, generators and arrows): 31 are refused by name, and 7 still throw
// `ClassCastException` at a cast of the erased generator.
//
// The control is `tests/programs/an-array-passed-to-an-array-pattern-parameter`,
// which differs in one thing: the argument is an array.
//
// Found on 2026-10-15 by the JVM lane's first test262 parity run.
//
// **Since 2026-10-20 the parameter is erased**, as an elision pattern
// nothing annotates (`elision_patterns::takes_any_iterable`), so the call
// erases the generator and `skip` steps it once. The record is a guard on
// the JVM; a change that declares the parameter as an array again shows here
// as the refused store.

function* nothing() {}

function skip([,]) {
  return 1;
}

/** @param {number} n @returns {number} */
export function patternOverAGenerator(n) {
  return skip(nothing()) + n;
}
