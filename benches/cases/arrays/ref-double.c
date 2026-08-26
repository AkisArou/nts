/* The same kernel with every value an f64 and every access tested, which is
   what the compiler emits when nothing is proven. */
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static int32_t to_int32(double x) {
    if (x > -2147483649.0 && x < 2147483648.0) { return (int32_t)x; }
    if (!isfinite(x)) { return 0; }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) { m += 4294967296.0; }
    return (int32_t)(uint32_t)m;
}
static uint32_t check(double index, uint32_t length) {
    if (!(index >= 0.0 && index < (double)length
          && index == (double)(uint32_t)index)) { abort(); }
    return (uint32_t)index;
}

static double convolve(double seed) {
    static const double xs[32] = { 0, 37, 74, 10, 47, 84, 20, 57, 94, 30, 67, 3, 40, 77, 13, 50, 87, 23, 60, 97, 33, 70, 6, 43, 80, 16, 53, 90, 26, 63, 100, 36 };
    double total = 0;
    for (double round = 0; round < 128; round = round + 1) {
        for (double i = 1; i < 32; i = i + 1) {
            /* Grouped exactly as `total += a * b + c` groups in TypeScript:
               `total + (a * b + c)`, one serialized add rather than two.
               Getting this wrong made the reference look 1.9x slower than the
               compiler, which was a fact about the reference. */
            total = total + (xs[check(i, 32)] * xs[check(i - 1, 32)]
                             + (double)to_int32(seed));
        }
    }
    return total;
}
double bench_run(void) {
    volatile double seed = 3;
    return convolve(seed);
}
