#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    double accumulate(double n);
}

double bench_run(void) {
    volatile double n = 1000;
    return accumulate(n);
}
