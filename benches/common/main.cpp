// Times bench_run() and prints "<ns per op> <checksum>".
//
// The checksum is not decoration. The runner compares it across variants, so a
// backend that is fast because it computes the wrong thing fails the benchmark
// rather than winning it.
#include <chrono>
#include <cstdio>
#include "harness.h"

static double now_ns(void) {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return static_cast<double>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(now).count());
}

int main(void) {
    // Warm up, and take the value the runner will compare.
    double checksum = bench_run();

    // Calibrate to roughly 100ms of work, so a fast case is not measured by
    // clock granularity and a slow one does not take all day.
    double start = now_ns();
    volatile double sink = bench_run();
    double one = now_ns() - start;
    long reps = static_cast<long>(1e8 / (one > 1.0 ? one : 1.0));
    if (reps < 1) {
        reps = 1;
    }
    if (reps > 50000000) {
        reps = 50000000;
    }

    // Best of five. The minimum is the run least contaminated by the scheduler:
    // the mean measures the machine's other tenants as much as the code.
    double best = 1e30;
    for (int trial = 0; trial < 5; trial++) {
        double began = now_ns();
        for (long i = 0; i < reps; i++) {
            sink += bench_run();
        }
        double per = (now_ns() - began) / static_cast<double>(reps);
        if (per < best) {
            best = per;
        }
    }

    static_cast<void>(sink);
    printf("%.4f %.17g\n", best, checksum);
    return 0;
}
