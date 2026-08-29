#include "harness.h"

extern "C" {
    double erasureStoredUnknown(double seed);
}

double bench_run(void) {
    volatile double seed = 12345;
    return erasureStoredUnknown(seed);
}
