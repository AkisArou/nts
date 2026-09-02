// `String(n)`, which is in nearly every program and was in no benchmark.
//
// This row exists because a 56x improvement was invisible: `String(1234567)`
// went from 1334ns to 23.7ns when `js_dtoa` replaced a loop that called
// `snprintf("%.*e")` and `strtod` at every precision from 1 to 17 until one
// round-tripped -- and not one case in the suite formatted a number in its hot
// path, so the whole table moved by noise. A win nothing measures is a win
// nobody can defend.
//
// Integers, because that is what real code formats -- indices, counts,
// identifiers -- and because it is where the old approach was worst: seven
// digits meant seven round trips. It is also the only shape a C++ reference can
// match exactly, since `std::to_string(double)` is six fixed decimals and
// `String` is the shortest round-tripping decimal.
//
// Everything depends on `seed`, so none of it folds away.
export function format(seed: number): number {
  let total = 0;
  for (let round = 0; round < 64; round++) {
    const small = (round + seed) | 0;
    const wide = (round * 7919 + seed) | 0;
    const negative = (0 - wide) | 0;
    // Every character, not the length and not the first one.
    //
    // `String(n).length` is a digit count, which an optimiser can produce
    // without building the string -- reading only the length, node measured
    // 2.7ns a call against a digit conversion that takes 5ns on its own, which
    // is not a number any implementation of this reaches. Reading the first
    // character moved node to 3.4ns, so it was still eliding part of it.
    // Summing all of them settles the question: the string has to exist.
    const a = String(small);
    const b = String(wide);
    const c = String(negative);
    for (let k = 0; k < a.length; k++) {
      total = (total + a.charCodeAt(k)) | 0;
    }
    for (let k = 0; k < b.length; k++) {
      total = (total + b.charCodeAt(k)) | 0;
    }
    for (let k = 0; k < c.length; k++) {
      total = (total + c.charCodeAt(k)) | 0;
    }
  }
  return total;
}
