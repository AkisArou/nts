/* The same with native integers. Every value here is a small whole number, so
   this is the ceiling the analysis is aiming at -- the three obligations are
   dischargeable, unlike `fib` (see docs/records/0004). */
#include <stdint.h>
#include <stdlib.h>
#include "harness.h"

typedef struct {
    int64_t x;
    int64_t y;
} Vec2;

static int64_t dot(const Vec2 *self, const Vec2 *other) {
    return self->x * other->x + self->y * other->y;
}

static int64_t simulate(int64_t seed) {
    Vec2 *base = (Vec2 *)malloc(sizeof(Vec2));
    base->x = seed;
    base->y = seed + 1;
    int64_t total = 0;
    for (int64_t i = 0; i < 4096; i++) {
        Vec2 *point = (Vec2 *)malloc(sizeof(Vec2));
        point->x = i;
        point->y = i + 1;
        total = total + dot(point, base);
        free(point);
    }
    free(base);
    return total;
}

double bench_run(void) {
    volatile int64_t seed = 3;
    return (double)simulate(seed);
}
