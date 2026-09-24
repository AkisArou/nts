#include "bench.h"

#include <stdio.h>
#include <stdlib.h>
#include <time.h>

double bench_now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6;
}

const char *bench_case(void) {
  const char *name = getenv("BENCH_CASE");
  return name != NULL ? name : "";
}

void bench_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
