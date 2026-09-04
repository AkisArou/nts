#include "harness.h"

extern "C" {
    double erasureStoredTyped(double seed);
}

double bench_run(void) {
    volatile double seed = 12345;
    return erasureStoredTyped(seed);
}
