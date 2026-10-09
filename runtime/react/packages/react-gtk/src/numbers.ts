// The conversions a number makes on its way into a C slot. A prop's value
// arrives erased, as whatever the app wrote, and GTK takes an `int`, an
// `unsigned int` or a `float`: the program writes the conversion, and the
// compiler proves each result fits its C type from the checks below. A value
// that does not fit is the app's mistake, so it throws a RangeError naming
// the prop rather than reaching C as some other number.

import type { Float32, c_int, c_uint } from "@nts/scalars";

/** `value` as a C `int`, or a RangeError naming `prop`. */
export function cInt(value: number, prop: string): c_int {
  if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
    return value + 0; // -0 is 0 to C
  }
  throw new RangeError(`${prop}: ${String(value)} is not a C int`);
}

/** `value` as a C `unsigned int` (an enum's value too), or a RangeError naming `prop`. */
export function cUint(value: number, prop: string): c_uint {
  if (Number.isInteger(value) && value >= 0 && value <= 4294967295) {
    return value + 0;
  }
  throw new RangeError(`${prop}: ${String(value)} is not a C unsigned int`);
}

/** `value` as a C `float`: the rounding C would make, written. */
export function cFloat(value: number): Float32 {
  return Math.fround(value);
}

/**
 * A delay in milliseconds as GLib's `guint` interval: whole, at least 0 and at
 * most `G_MAXUINT`. NaN and a negative delay run as soon as they can, as a
 * browser's `setTimeout` runs them.
 */
export function cDelay(ms: number): c_uint {
  const whole = Math.ceil(ms);
  if (Number.isInteger(whole) && whole > 0) {
    return Math.min(whole, 4294967295) + 0;
  }
  return 0;
}
