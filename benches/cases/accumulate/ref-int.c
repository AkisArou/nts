/* What a C programmer writes. Unsigned for the wrapping, which is the
   semantics of JavaScript's bitwise operators rather than an accident. */
#include <stdint.h>
static int32_t accumulate(int32_t seed) {
    uint32_t h = (uint32_t)seed;
    int32_t total = 0;
    for (int32_t i = 0; i < 4096; i++) {
        h = h * 31u + (uint32_t)i;
        total += (int32_t)(h & 255u);
    }
    return total;
}
double bench_run(void) {
    volatile int32_t seed = 12345;
    return (double)accumulate(seed);
}
