#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    double checksum(double seed);
}

double bench_run(void) {
    volatile double seed = 12345;
    return checksum(seed);
}
