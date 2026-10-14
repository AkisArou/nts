// The pushing half of the control. Deliberately without `reserve`, because the
// TypeScript beside it does not reserve either.
//
// `std::vector` is a pointer to a heap block whether or not anything ever
// pushes to it, so both halves get the same representation here and the C++
// ratio between them should be about **one**. Whatever the nts ratio is above
// that is the whole-program `arrays_can_grow` cliff, isolated -- a reference
// that paid the same cost on both sides is what turns a number into a
// measurement.
//
// **Confirm that ratio is near 1.0 before trusting it as a baseline.** If it is
// not, the instrument is talking rather than `std::vector`: two kernels that
// differ only in setup are still two kernels, and `volatile` placement changes
// what the optimizer is allowed to do to a loop by different amounts for
// different shapes. Same structure in both files is necessary and not
// sufficient.
//
// The input is `volatile` at the call site and the kernel takes it as a plain
// parameter, because the generated function has no choice about that and
// anything else compares two harnesses rather than two compilers.
#include <cstdint>
#include <vector>
#include "harness.h"

static double scan(std::int32_t seed) {
    const std::int32_t n = 2048;
    std::vector<double> xs;
    for (std::int32_t i = 0; i < n; i++) {
        xs.push_back(static_cast<double>(i) * 7 + static_cast<double>(seed));
    }
    // Each round reads what the round before it wrote, so the inner loop is not
    // invariant and cannot be hoisted out and multiplied by the round count.
    // Floating-point addition is not reassociable without `-ffast-math`, so the
    // dependence survives every optimizer this is built with.
    for (std::int32_t round = 0; round < 64; round++) {
        for (std::int32_t i = 1; i < n; i++) {
            xs[static_cast<std::size_t>(i)] =
                xs[static_cast<std::size_t>(i)] * 0.75 +
                xs[static_cast<std::size_t>(i - 1)] * 0.25;
        }
    }
    double total = 0;
    for (std::int32_t i = 0; i < n; i++) {
        total = total + xs[static_cast<std::size_t>(i)];
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return scan(seed);
}
