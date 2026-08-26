#include "harness.h"
double simulate(double seed);
double bench_run(void) {
    volatile double seed = 3;
    return simulate(seed);
}
