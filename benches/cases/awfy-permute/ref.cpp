// The reference is Are We Fast Yet's own C++ port, unchanged.
//
// That is the point of it: it was written by the suite's authors rather than by
// whoever is being measured, and it is what a C++ programmer produced for this
// benchmark. Where it differs from the JavaScript -- `std::array` on the stack
// where the original allocates, `std::any` boxing the result -- those are the
// port's decisions and they stand.
//
// The standard headers come first because their sources expect a prelude their
// own build script provides. That is a build detail, not a change to the
// program.
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
#include "permute.h"

double bench_run(void) {
    Permute benchmark;
    volatile int32_t iterations = 1;
    return benchmark.inner_benchmark_loop(iterations) ? 1 : 0;
}
