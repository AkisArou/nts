#define _POSIX_C_SOURCE 200809L

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>

#include "nts_runtime.h"

double typedHookReads(double iterations);
double erasedHookReads(double iterations, bool choose_string);
double typedAlternatingReads(double iterations, double first, double second);
double erasedAlternatingReads(double iterations, NtsValue first, NtsValue second);

static uint64_t now_ns(void) {
  struct timespec value;
  clock_gettime(CLOCK_MONOTONIC, &value);
  return (uint64_t)value.tv_sec * 1000000000ull + (uint64_t)value.tv_nsec;
}

typedef double (*BenchFn)(double);

static double erased_number(double iterations) {
  return erasedHookReads(iterations, false);
}

static double typed_alternating(double iterations) {
  return typedAlternatingReads(iterations, 1.0, 2.0);
}

static double erased_alternating(double iterations) {
  return erasedAlternatingReads(iterations, nts_value_of_number(1.0),
                                nts_value_of_number(2.0));
}

static uint64_t measure(BenchFn function, double iterations, int repetitions,
                        volatile double *sink) {
  const uint64_t begin = now_ns();
  for (int repetition = 0; repetition < repetitions; repetition++) {
    *sink += function(iterations);
  }
  return now_ns() - begin;
}

int main(void) {
  const double iterations = 1000000.0;
  const int repetitions = 100;
  volatile double sink = 0.0;

  sink += typedHookReads(10.0);
  sink += erasedHookReads(10.0, false);
  sink += typed_alternating(10.0);
  sink += erased_alternating(10.0);

  puts("sample,steady_typed_ns,steady_erased_ns,steady_ratio,alternating_typed_ns,alternating_erased_ns,alternating_ratio");
  for (int sample = 0; sample < 9; sample++) {
    const uint64_t steady_typed =
        measure(typedHookReads, iterations, repetitions, &sink);
    const uint64_t steady_erased =
        measure(erased_number, iterations, repetitions, &sink);
    const uint64_t alternating_typed =
        measure(typed_alternating, iterations, repetitions, &sink);
    const uint64_t alternating_erased =
        measure(erased_alternating, iterations, repetitions, &sink);
    printf("%d,%llu,%llu,%.6f,%llu,%llu,%.6f\n", sample,
           (unsigned long long)steady_typed,
           (unsigned long long)steady_erased,
           (double)steady_erased / (double)steady_typed,
           (unsigned long long)alternating_typed,
           (unsigned long long)alternating_erased,
           (double)alternating_erased / (double)alternating_typed);
  }

  if (sink == 0.0) {
    return 2;
  }
  return 0;
}
