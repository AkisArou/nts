/* The same algorithm with TypeScript's semantics spelled out by hand: every
   value an f64, every bitwise step going through ToInt32 and back. This is
   what the operations *mean*, and what they cost when nothing proves that the
   doubles are holding integers. */
#include <stdint.h>
#include <math.h>

static int32_t to_int32(double x) {
    if (!isfinite(x)) { return 0; }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) { m += 4294967296.0; }
    return (int32_t)(uint32_t)m;
}
static uint32_t to_uint32(double x) {
    if (!isfinite(x)) { return 0; }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) { m += 4294967296.0; }
    return (uint32_t)m;
}

static double checksum(double seed) {
    double h = (double)to_int32(seed);
    for (double i = 0; i < 4096; i = i + 1) {
        h = (double)to_int32(h * 31 + i);
        /* h ^= h >>> 7 */
        double shifted = (double)(to_uint32(h) >> 7);
        h = (double)(to_int32(h) ^ to_int32(shifted));
        /* h = ((h << 5) - h) | 0 */
        double shifted_left = (double)(int32_t)((uint32_t)to_int32(h) << 5);
        h = (double)to_int32(shifted_left - h);
    }
    return h;
}

double bench_run(void) {
    volatile double seed = 12345;
    return checksum(seed);
}
