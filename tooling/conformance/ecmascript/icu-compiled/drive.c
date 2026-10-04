#include "program.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
int main(int argc, char **argv) {
  module__init();
  if (argc > 1) {
    double iterations = strtod(argv[1], NULL);
    if (argc > 2 && strcmp(argv[2], "plural") == 0) {
      const bool range = argc > 3 && strcmp(argv[3], "range") == 0;
      (void)benchmarkPlural(5000, range);
      struct timespec from, to;
      clock_gettime(CLOCK_MONOTONIC, &from);
      double checksum = benchmarkPlural(iterations, range);
      clock_gettime(CLOCK_MONOTONIC, &to);
      double elapsed = (double)(to.tv_sec - from.tv_sec) * 1e9 + (double)(to.tv_nsec - from.tv_nsec);
      printf("{\"backend\":\"c-rc\",\"mode\":\"plural-%s\",\"nsPerSelect\":%.3f,\"checksum\":%.0f}\n", range ? "range" : "scalar", elapsed / iterations, checksum);
      return 0;
    }
    if (argc > 2) {
      double count = strtod(argv[2], NULL);
      (void)benchmarkList(200, count);
      struct timespec from, to;
      clock_gettime(CLOCK_MONOTONIC, &from);
      double checksum = benchmarkList(iterations, count);
      clock_gettime(CLOCK_MONOTONIC, &to);
      double elapsed = (double)(to.tv_sec - from.tv_sec) * 1e9 + (double)(to.tv_nsec - from.tv_nsec);
      printf("{\"backend\":\"c-rc\",\"mode\":\"list-assembly\",\"items\":%.0f,\"nsPerFormat\":%.3f,\"checksum\":%.0f}\n", count, elapsed / iterations, checksum);
      return 0;
    }
    (void)benchmark(5000);
    struct timespec from, to;
    clock_gettime(CLOCK_MONOTONIC, &from);
    double checksum = benchmark(iterations);
    clock_gettime(CLOCK_MONOTONIC, &to);
    double elapsed = (double)(to.tv_sec - from.tv_sec) * 1e9 + (double)(to.tv_nsec - from.tv_nsec);
    printf("{\"backend\":\"c-rc\",\"nsPerFormat\":%.3f,\"checksum\":%.0f}\n", elapsed / iterations, checksum);
    return 0;
  }
  NtsString *result = main_();
  const char *utf8 = nts_string_to_cstring(result);
  puts(utf8);
  nts_cstring_release(result, utf8);
  nts_release((NtsHeader *)result);
  return 0;
}
