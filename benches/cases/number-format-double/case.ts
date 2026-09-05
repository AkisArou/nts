// `String(x)` where `x` is not an integer, which is a different algorithm.
//
// An integer is a digit loop. A double is the *shortest decimal that reads back
// as the same value*, which is a real algorithm with a real cost -- and it is
// the one `number-format` deliberately does not measure, because that row is
// about the fast path and about being comparable to `std::to_string`.
//
// There is no `ref.cpp` on purpose: `std::to_string(double)` is six fixed
// decimals, which is a different answer rather than a different format, and a
// C++ column that prints `0.333333` cannot be divided into one that prints
// `0.3333333333333333`. node is the comparison that means something here.
//
// Three shapes, because the algorithm branches on them: a repeating decimal
// that needs all seventeen digits, a short one that needs two, and an exact
// binary fraction that needs a few.
//
// Every character is summed rather than the length read: V8 computes a digit
// count without building the string, and a row that lets it do that measures
// the elision instead of the work.
export function format(seed: number): number {
  let total = 0;
  for (let round = 0; round < 64; round++) {
    const base = round + seed;
    const a = base / 7;
    const b = base * 1.5;
    const c = base / 1024;
    const sa = String(a);
    const sb = String(b);
    const sc = String(c);
    for (let k = 0; k < sa.length; k++) {
      total = (total + sa.charCodeAt(k)) | 0;
    }
    for (let k = 0; k < sb.length; k++) {
      total = (total + sb.charCodeAt(k)) | 0;
    }
    for (let k = 0; k < sc.length; k++) {
      total = (total + sc.charCodeAt(k)) | 0;
    }
  }
  return total;
}

/**
 * The input the harness calls `format` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
