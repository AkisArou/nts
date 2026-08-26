/* Times bench_run() and prints "<ns per op> <checksum>".
 *
 * The checksum is not decoration. The runner compares it across variants, so a
 * backend that is fast because it computes the wrong thing fails the benchmark
 * rather than winning it.
 */
/* clock_gettime is POSIX, not ISO C, and -std=c11 hides it without this. */
#define _POSIX_C_SOURCE 199309L

#include <stdio.h>
#include <time.h>
#include "harness.h"

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

int main(void) {
    /* Warm up, and take the value the runner will compare. */
    double checksum = bench_run();

    /* Calibrate to roughly 100ms of work, so a fast case is not measured by
     * clock granularity and a slow one does not take all day. */
    double start = now_ns();
    volatile double sink = bench_run();
    double one = now_ns() - start;
    long reps = (long)(1e8 / (one > 1.0 ? one : 1.0));
    if (reps < 1) {
        reps = 1;
    }
    if (reps > 50000000) {
        reps = 50000000;
    }

    /* Best of five. The minimum is the run least contaminated by the scheduler:
     * the mean measures the machine's other tenants as much as the code. */
    double best = 1e30;
    for (int trial = 0; trial < 5; trial++) {
        double began = now_ns();
        for (long i = 0; i < reps; i++) {
            sink += bench_run();
        }
        double per = (now_ns() - began) / (double)reps;
        if (per < best) {
            best = per;
        }
    }

    (void)sink;
    printf("%.4f %.17g\n", best, checksum);
    return 0;
}
