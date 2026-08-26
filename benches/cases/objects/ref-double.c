/* What a C programmer writes: one allocation per object, freed when the object
   is done with. No header, because a hand-written struct does not carry one --
   which is part of what the gap measures. */
#include <stdlib.h>
#include "harness.h"

typedef struct {
    double x;
    double y;
} Vec2;

static double dot(const Vec2 *self, const Vec2 *other) {
    return self->x * other->x + self->y * other->y;
}

static double simulate(double seed) {
    Vec2 *base = (Vec2 *)malloc(sizeof(Vec2));
    base->x = seed;
    base->y = seed + 1;
    double total = 0;
    for (int i = 0; i < 4096; i++) {
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
    volatile double seed = 3;
    return simulate(seed);
}
