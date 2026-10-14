// `"".codePointAt(0) ?? (-1 >>> 4)` answered **0** on C and **134217727** on
// the JVM, where node says 268435455.
//
// Every bitwise operator --- `&`, `|`, `^` and the three shifts --- takes its
// operands as a 32-bit integer, and JavaScript defines them through `ToInt32`
// and `ToUint32`, which **wrap modulo 2^32**. Both backends were narrowing with
// their language's own conversion instead:
//
//     C     `(int32_t)4294967295.0`   undefined for a value out of range
//     JVM   `d2i`                     saturates to Integer.MAX_VALUE
//
// and both had written down that this was safe. C's cast carried no comment;
// the JVM's said *"the narrowing is exact rather than a conversion --- what
// reaches here is an integral value that was widened to a double, and `d2i`
// undoes the widening. Same reason C's cast is exact."* The premise is true of
// the *shape* --- the value is integral --- and false about the *range*, which
// is the one thing the conversion depends on. Two backends, one argument, both
// wrong, each citing the other.
//
// Both now use the runtime's own `nts_to_uint32` / `toInt32`, which is the rule
// the JVM already applies at every other boundary --- its file says so twice,
// including *"`d2i` is the wrong instruction and it is wrong quietly"*.
//
// # Why it took a fuzzer
//
// `-1 >>> 4` on its own is **constant-folded**, so the bug needs an operand
// that survives to run time. `??` is one way: the nullish join keeps both arms
// as doubles. And giving the specializer a second site that computes the same
// shift narrows the first, so the bug disappears the moment a reduction adds
// `function b() { return -1 >>> 4 }` to check the arithmetic --- which is
// exactly what my first reduction did.
//
// Found by `tooling/conformance/fuzz-expressions.mjs` at seed 68, from
// `("".codePointAt(0) ?? -1 >>> 4)`, whose parenthesisation nobody would write.
//
// LLVM never had it: it declines `NTS3001 the operator UShr on this
// representation` rather than guessing, and now compiles the same programs the
// other two do.

const absent = "".codePointAt(0) ?? (-1 >>> 4);
const large = "ab".codePointAt(3) ?? (9007199254740991 >>> 2);

export function aNullishShiftOfANegative(): number {
  return absent;
}

export function aNullishShiftOfALargeValue(): number {
  return large;
}

/// `1e20` is integral and nowhere near `int32`, which is the whole subject.
export function toInt32Wraps(n: number): number {
  return n | 0;
}

export function unsignedShiftWraps(n: number): number {
  return n >>> 1;
}

export function everyBitwiseOperator(n: number): number {
  return ((n | 0) ^ (n >>> 1)) + (n & 7) - (n << 2) + (n >> 3) + ~n;
}
