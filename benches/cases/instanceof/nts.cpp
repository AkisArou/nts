#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    double run(double rounds);
}

double bench_run(void) {
    /* Opaque, so the whole call cannot be folded to a constant. */
    volatile double n = 100000;
    return run(n);
}
