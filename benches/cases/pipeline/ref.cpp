// What a C++ programmer writes: `std::transform` into a vector of the right
// size, then `std::accumulate`. Not a single fused loop, because that is not
// what the TypeScript says -- `map` produces an array and `reduce` consumes it,
// and a reference that fused them would be measuring a transformation the
// compiler under test is not allowed to make either.
//
// `xs` is filled by index rather than by `push_back` to match the TypeScript,
// which indexes for a reason of its own -- see the comment there. `scaled` is
// allocated inside the timed rounds because `map` allocates.
#include <algorithm>
#include <numeric>
#include <vector>
#include "harness.h"

static double work(double seed) {
    constexpr int length = 1024;
    std::vector<double> xs(length);
    for (int i = 0; i < length; i++) {
        xs[i] = seed * 0.5 + i * 0.25;
    }

    double total = 0;
    for (int round = 0; round < 64; round++) {
        // Reads `round`, so the pipeline is not loop-invariant -- see the
        // comment in the TypeScript for why that matters to the measurement.
        std::vector<double> scaled(xs.size());
        std::transform(xs.begin(), xs.end(), scaled.begin(),
                       [round](double v) { return v * 3.5 + round; });
        total = total + std::accumulate(scaled.begin(), scaled.end(), 0.0,
                                        [](double acc, double v) { return acc + v * 0.5; });
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 7;
    return work(seed);
}
