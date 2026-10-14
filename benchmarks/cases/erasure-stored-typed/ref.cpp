// The ceiling: a scan over an array of doubles, which is what the typed half
// should reach and what the erased half is being measured against.
#include <cstdint>
#include <vector>
#include "harness.h"

static double stored(double seed) {
    std::vector<double> values(2000);
    for (std::int32_t i = 0; i < 2000; i++) {
        values[static_cast<std::size_t>(i)] = seed + i;
    }
    double total = 0;
    for (std::int32_t round = 0; round < 100; round++) {
        for (std::int32_t i = 0; i < 2000; i++) {
            total = total + values[static_cast<std::size_t>(i)];
        }
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 12345;
    return stored(seed);
}
