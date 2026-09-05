// What a Java programmer writes for a scalar accumulation: an `int` counter and
// a `double` accumulator.
//
// The counter is the whole question on this row, so it is worth saying why it
// is `int` when the TypeScript says `number`.
//
// A Java programmer writes `int i` here without thinking about it -- a loop
// bounded by a count is an `int` loop, and `i / 2` is written `i / 2.0` to keep
// the division floating. Writing `double i` instead would be a transliteration
// of the *types* rather than of the program, and it would hand this lane a
// `vcvtsi2sd`-free loop that no person would have written. Record 0106 priced
// exactly this difference on `generator` at about 30%, in the counter's
// conversion and not in the accumulator, so choosing wrongly here would not be
// a rounding error -- it would be the entire ratio.
//
// It is also the fair choice rather than the generous one: this compiler
// specializes `i` to an `i32` when it can prove the range, so both lanes get an
// int counter and the ratio is about codegen. Where the proof fails, the
// reference should still be the version a person writes, and the gap is ours.
//
// `(double) i * i` rather than `i * i`, because the TypeScript multiplies in
// f64 and an `int` product would wrap at a bound this case does not reach but
// the semantics do not promise.
final class Ref extends Bench.Work {
    // `volatile` so the bound is not a compile-time constant: a known `n` lets
    // the JIT unroll to the trip count and turn the loop into a closed form.
    private static volatile double n = 1000;

    static double accumulate(double n) {
        double total = 0;
        for (int i = 0; i < n; i++) {
            total = total + (double) i * i - i / 2.0;
        }
        return total;
    }

    @Override public double run() {
        return accumulate(n);
    }
}
