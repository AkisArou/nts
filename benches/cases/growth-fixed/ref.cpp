// What a C++ programmer writes, and -- more usefully -- the *control* for this
// pair.
//
// `std::vector` is a pointer to a heap block whether or not anything ever
// pushes to it, so both halves of this pair get the same representation here
// and the C++ ratio between them should be one. Whatever the nts ratio is above
// that is the whole-program `arrays_can_grow` cliff, isolated: a reference that
// paid the same cost on both sides is what turns a number into a measurement.
#include <cstdint>
#include <vector>
#include "harness.h"

static double scan(std::int32_t seed) {
    const std::int32_t n = 2048;
    std::vector<double> xs(static_cast<std::size_t>(n));
    for (std::int32_t i = 0; i < n; i++) {
        xs[static_cast<std::size_t>(i)] = static_cast<double>(i) * 7 + static_cast<double>(seed);
    }
    double total = 0;
    for (std::int32_t round = 0; round < 64; round++) {
        for (std::int32_t i = 1; i < n; i++) {
            // Grouped as TypeScript groups it: `total + (a * b)`, one
            // serialized add. Getting this wrong once made a reference look
            // 1.9x slower than the compiler, which was a fact about the
            // reference.
            total = total + xs[static_cast<std::size_t>(i)] * xs[static_cast<std::size_t>(i - 1)];
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return scan(seed);
}
