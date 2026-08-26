/* What a C programmer writes: integer index, no test, direct access. */
#include <stdint.h>
static double convolve(int32_t seed) {
    static const double xs[32] = { 0, 37, 74, 10, 47, 84, 20, 57, 94, 30, 67, 3, 40, 77, 13, 50, 87, 23, 60, 97, 33, 70, 6, 43, 80, 16, 53, 90, 26, 63, 100, 36 };
    double total = 0;
    for (int32_t round = 0; round < 128; round++) {
        for (int32_t i = 1; i < 32; i++) {
            /* Grouped as `total += a * b + c` groups in TypeScript. */
            total = total + (xs[i] * xs[i - 1] + (double)seed);
        }
    }
    return total;
}
double bench_run(void) {
    volatile int32_t seed = 3;
    return convolve(seed);
}
