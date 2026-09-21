// `n.toFixed(d)`, and the rounding is the whole of it.
//
// # Why this is not `printf("%.*f")`
//
// The specification picks the integer `n` for which `n / 10^f - x` is closest
// to zero and, **on a tie, the larger n** -- half away from zero. C's `printf`
// and Java's formatter both round half to even, so they disagree on every
// exact tie. Measured before anything was built:
//
// ```text
//   x        d   node     printf
//   0.5      0   "1"      "0"
//   2.5      0   "3"      "2"
//   0.125    2   "0.13"   "0.12"
//   -2.5     0   "-3"     "-2"
//   1e21     2   "1e+21"  "1000000000000000000000.00"
// ```
//
// Five of eleven sampled cases. A helper written the obvious way would have
// compiled, linked, and been wrong -- the shape this project refuses on
// principle.
//
// # What is done instead, and why it is correct by construction
//
// Every double has a **terminating** decimal expansion, and that expansion is
// exactly what "the n closest to x" is about. So the C helper prints it in
// full and rounds the digit string half away from zero; the Java one hands the
// same fact to `new BigDecimal(double)`, which takes the double's exact value,
// with `RoundingMode.HALF_UP`.
//
// That is why `1.005` gives `"1.00"` and not `"1.01"`: it is really
// 1.00499999999999989..., so the exact expansion rounds *down*. Node answers
// the same for the same reason, rather than by coincidence.
//
// # The pieces
//
// A runtime helper per backend -- `nts_number_to_fixed` in C, `numberToFixed`
// in `NtsRuntime.java` -- and a range check in the lowering, because a
// provided `RangeError` is a class the runtime has no way to construct. That
// asymmetry is what `throw_provided_error_text` exists for, and
// `lower_radix_to_string` is the same shape one method over.
//
// # How it was found
//
// The statement fuzzer, after its grammar was widened into classes and number
// formatting: 14 draws in 3,000 cases, and the only wall in that run which was
// not already a recorded decision. Nothing in the census would have shown it
// -- three sites in `runtime/node` is far below the rows a census ranks.

export function half(n: number): string {
  return (0.5 + (n - n)).toFixed(0);
}

export function twoAndAHalf(n: number): string {
  return (2.5 + (n - n)).toFixed(0);
}

export function anEighth(n: number): string {
  return (0.125 + (n - n)).toFixed(2);
}

export function negativeTie(n: number): string {
  return (-2.5 + (n - n)).toFixed(0);
}

// Not a tie at all: the double is below the midpoint, so it rounds down.
export function looksLikeATie(n: number): string {
  return (1.005 + (n - n)).toFixed(2);
}

// The carry runs off the front and grows the number.
export function carries(n: number): string {
  return (9.995 + (n - n)).toFixed(2);
}

// The sign survives a magnitude that rounded away.
export function negativeZero(n: number): string {
  return (-0.4 + (n - n)).toFixed(0);
}

export function plain(n: number): string {
  return (123.456 + (n - n)).toFixed(1);
}

export function zeroDigits(n: number): string {
  return (7.7 + (n - n)).toFixed(0);
}

export function manyDigits(n: number): string {
  return (1.5 + (n - n)).toFixed(8);
}

// At or above 1e21 the specification defers to `ToString`.
export function handsOffToToString(n: number): string {
  return (1e21 + (n - n)).toFixed(2);
}

export function belowTheHandoff(n: number): string {
  return (1e20 + (n - n)).toFixed(1);
}
