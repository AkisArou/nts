// Integer loop counters, floating-point arithmetic. That split is not a
// concession: the escape test is inherently floating point, so this is what a
// C++ programmer writes and there is no faster honest version.
#include "harness.h"
#include <cstdint>

static double escapes(double cr, double ci) {
  double zr = 0, zi = 0;
  for (std::int32_t i = 0; i < 50; i++) {
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

static double mandelbrot(std::int32_t size) {
  double count = 0;
  for (std::int32_t y = 0; y < size; y++) {
    for (std::int32_t x = 0; x < size; x++) {
      count += escapes(static_cast<double>(x) / size * 3 - 2,
                       static_cast<double>(y) / size * 3 - 1.5);
    }
  }
  return count;
}

double bench_run(void) {
  volatile std::int32_t size = 64;
  return mandelbrot(size);
}
