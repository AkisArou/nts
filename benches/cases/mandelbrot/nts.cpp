#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
double mandelbrot(double size);
}

double bench_run(void) {
  volatile double size = 64;
  return mandelbrot(size);
}
