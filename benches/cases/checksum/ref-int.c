/* What a C programmer writes. Unsigned throughout, because JavaScript's
   bitwise operators are defined modulo 2^32 and signed overflow is undefined
   in C -- the wrapping is the semantics, not an accident. */
#include <stdint.h>
static int32_t checksum(int32_t seed) {
    uint32_t h = (uint32_t)seed;
    for (int32_t i = 0; i < 4096; i++) {
        h = h * 31u + (uint32_t)i;
        h ^= h >> 7;
        h = (h << 5) - h;
    }
    return (int32_t)h;
}
double bench_run(void) {
    volatile int32_t seed = 12345;
    return (double)checksum(seed);
}
