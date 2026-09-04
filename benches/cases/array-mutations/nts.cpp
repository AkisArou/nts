#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    double mutations(double seed);
}

double bench_run(void) {
    volatile double seed = 3;
    return mutations(seed);
}
