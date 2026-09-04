#include "harness.h"

extern "C" {
    double work(double seed);
}

double bench_run(void) {
    volatile double seed = 5;
    return work(seed);
}
