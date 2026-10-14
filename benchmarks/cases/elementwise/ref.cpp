// What a C++ programmer writes, and what clang vectorizes: an elementwise map
// over contiguous doubles with an integer counter.
//
// The point of the comparison is the counter. This one is a `std::size_t`, so
// the index is an affine integer sequence and the loop vectorizes; ours is a
// `double` bounded by a `uint32_t` length, and it does not.
#include <cstdio>
#include <vector>
#include "harness.h"

static double scale(std::vector<double> &xs, double seed) {
    const double k = seed;
    for (int round = 0; round < 512; round++) {
        for (std::size_t i = 0; i < xs.size(); i++) {
            xs[i] = xs[i] * k;
        }
    }
    return xs[0] + xs[xs.size() - 1];
}

// Allocated once and refilled, so both sides measure the loop rather than an
// allocator. See `nts.cpp`.
double bench_run(void) {
    volatile double seed = 1.0000001;
    static std::vector<double> xs(4096);
    for (std::size_t i = 0; i < xs.size(); i++) {
        xs[i] = 1.0;
    }
    return scale(xs, seed);
}
