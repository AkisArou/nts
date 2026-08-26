#include <stdint.h>
/* Only the loop counters become integers; the arithmetic is inherently
 * floating point. This is the honest ceiling for a float-heavy kernel. */
static double escapes(double cr, double ci) {
    double zr = 0, zi = 0;
    for (int32_t i = 0; i < 50; i++) {
        const double zr2 = zr * zr;
        const double zi2 = zi * zi;
        if (zr2 + zi2 > 4) {
            return 0;
        }
        zi = 2 * zr * zi + ci;
        zr = zr2 - zi2 + cr;
    }
    return 1;
}
static double mandelbrot(int32_t size) {
    double count = 0;
    for (int32_t y = 0; y < size; y++) {
        for (int32_t x = 0; x < size; x++) {
            count += escapes(((double)x / size) * 3 - 2, ((double)y / size) * 3 - 1.5);
        }
    }
    return count;
}
double bench_run(void) {
    volatile int32_t size = 64;
    return mandelbrot(size);
}
