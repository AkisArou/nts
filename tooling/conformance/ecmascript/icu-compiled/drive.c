#include "program.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
int main(int argc, char **argv) {
  module__init();
  if (argc > 1) {
    double iterations = strtod(argv[1], NULL);
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
