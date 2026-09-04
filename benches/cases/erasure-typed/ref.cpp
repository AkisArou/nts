// The ceiling both halves of the pair are aiming at, and deliberately the same
// file in both: erasure is a property of the TypeScript, not of the algorithm,
// so a C++ programmer writes this either way. The gap between the two `nts`
// columns is what erasure costs; the gap to this column is what it costs
// against not being a dynamic language at all.
#include <cstdint>
#include "harness.h"

static double erasure(double seed) {
    double total = 0;
    for (std::int32_t i = 0; i < 200000; i++) {
        const double carried = seed + i;
        // `typeof carried === "number"` is a constant here, because in C++
        // there was never a question.
        total = total + 1 + carried;
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 12345;
    return erasure(seed);
}
