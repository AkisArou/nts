// What a C++ programmer writes: an integer index, no bounds test, direct access.
#include <cstdint>
#include "harness.h"

static double convolve(std::int32_t seed) {
    static const double xs[32] = {0,  37, 74, 10, 47, 84, 20, 57, 94, 30, 67,
                                  3,  40, 77, 13, 50, 87, 23, 60, 97, 33, 70,
                                  6,  43, 80, 16, 53, 90, 26, 63, 100, 36};
    double total = 0;
    for (std::int32_t round = 0; round < 128; round++) {
        for (std::int32_t i = 1; i < 32; i++) {
            // Grouped exactly as `total += a * b + c` groups in TypeScript:
            // `total + (a * b + c)`, one serialized add rather than two. Getting
            // this wrong once made the reference look 1.9x slower than the
            // compiler, which was a fact about the reference.
            total = total + (xs[i] * xs[i - 1] + static_cast<double>(seed));
        }
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return convolve(seed);
}
