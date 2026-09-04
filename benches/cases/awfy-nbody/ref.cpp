// The reference is Are We Fast Yet's own C++ port, unchanged.
//
// That is the point of it: it was written by the suite's authors rather than by
// whoever is being measured. See `awfy-sieve/ref.cpp` for why the standard
// headers come first.
//
// The 250,000 is the step count, and it is where the C++ port keeps it -- as
// `inner_benchmark_loop`'s argument. The TypeScript keeps it inside
// `benchmark()` and runs the driver once. Both advance the system 250,000 times
// and check the same recorded energy.
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <iostream>
#include <memory>
#include <vector>
#include <array>
#include <any>
#include <string>

#include "harness.h"
#include "nbody.h"

double bench_run(void) {
    NBody benchmark;
    volatile int32_t iterations = 250000;
    return benchmark.inner_benchmark_loop(iterations) ? 1 : 0;
}
