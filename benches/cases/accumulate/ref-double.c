/* The accumulator as a double, which is what the compiler must emit when it
   cannot bound it. The bitwise steps still go through ToInt32. */
#include <stdint.h>
#include <math.h>
static int32_t to_int32(double x) {
    if (x > -2147483649.0 && x < 2147483648.0) { return (int32_t)x; }
    if (!isfinite(x)) { return 0; }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) { m += 4294967296.0; }
    return (int32_t)(uint32_t)m;
}
static double accumulate(double seed) {
    double h = (double)to_int32(seed);
    double total = 0;
    for (double i = 0; i < 4096; i = i + 1) {
        h = (double)to_int32(h * 31 + i);
        total = total + (double)(to_int32(h) & 255);
    }
    return total;
}
double bench_run(void) {
    volatile double seed = 12345;
    return accumulate(seed);
}
