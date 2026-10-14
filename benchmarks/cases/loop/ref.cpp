// `i / 2` is real division in TypeScript, so an integer loop counter still needs
// a double accumulator to get the same answer. There is no all-integer version
// of this program that computes the same thing.
#include <cstdint>
#include "harness.h"

static double accumulate(std::int64_t n) {
    double total = 0;
    for (std::int64_t i = 0; i < n; i++) {
        total = total + static_cast<double>(i * i) - static_cast<double>(i) / 2;
    }
    return total;
}

double bench_run(void) {
    volatile std::int64_t n = 1000;
    return accumulate(n);
}
