// **Fixed 2026-10-15, and now its guard:** `parseInt`'s radix is `ToNumber` of
// what it is given. What it was:
//
// **A boolean radix reaches `parseInt` unconverted.** `parseInt("11", false)`
// is `parseInt("11", 0)` -- the radix is `ToNumber(false)` -- and the prepared
// HIR passes the boolean as it is: `call.extern nts_parse_int(%2, %3)` where
// `%3 : bool` and the runtime declares the parameter `f64`. The verifier
// accepts the call.
//
// C agrees with node by luck: C's call converts a `bool` to a `double`
// silently. The JVM's emitter counts the stack the declared parameter wants
// and refuses the function, "emitting %3 moved the operand stack from 0 to
// -1", so the program is not emitted. Test262's
// `built-ins/parseInt/S15.1.2.2_A3.1_T1`, which passes on C.
//
// The control is `tests/programs/a-number-radix-to-parse-int`, which differs in
// one thing: the radix is the number `0`.
//
// Found on 2026-10-15 by the JVM lane's first test262 parity run.

/** @param {number} n @returns {number} */
export function radixFalse(n) {
  return parseInt("11", false) + n;
}
