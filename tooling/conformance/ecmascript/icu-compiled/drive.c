#include "program.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
int main(int argc, char **argv) {
  module__init();
  if (argc > 1) {
    double iterations = strtod(argv[1], NULL);
    if (argc > 2 && strcmp(argv[2], "zoned-time") == 0) {
      const bool ambiguous = argc > 3 && strcmp(argv[3], "ambiguous") == 0;
      (void)benchmarkZonedTime(10000, ambiguous);
      struct timespec before, after;
      clock_gettime(CLOCK_MONOTONIC, &before);
      const double checksum = benchmarkZonedTime(iterations, ambiguous);
      clock_gettime(CLOCK_MONOTONIC, &after);
      printf("{\"backend\":\"c-rc\",\"mode\":\"zoned-time\",\"ambiguous\":%s,\"checksum\":%.0f,\"nsPerResolution\":%.3f}\n", ambiguous ? "true" : "false", checksum,
        ((after.tv_sec - before.tv_sec) * 1e9 + after.tv_nsec - before.tv_nsec) / iterations);
      return 0;
    }
    if (argc > 2 && strcmp(argv[2], "locale") == 0) {
      const bool cached = argc > 3 && strcmp(argv[3], "cached") == 0;
      (void)benchmarkLocale(cached ? 10000 : 200, cached);
      struct timespec before, after;
      clock_gettime(CLOCK_MONOTONIC, &before);
      const double checksum = benchmarkLocale(iterations, cached);
      clock_gettime(CLOCK_MONOTONIC, &after);
      printf("{\"backend\":\"c-rc\",\"mode\":\"locale-preferences\",\"cached\":%s,\"checksum\":%.0f,\"nsPerQuerySet\":%.3f}\n", cached ? "true" : "false", checksum,
        ((after.tv_sec - before.tv_sec) * 1e9 + after.tv_nsec - before.tv_nsec) / iterations);
      return 0;
    }
    if (argc > 2 && strcmp(argv[2], "segment") == 0) {
      const bool containing = argc > 3 && strcmp(argv[3], "containing") == 0;
      const bool wide = argc > 4 && strcmp(argv[4], "wide") == 0;
      (void)benchmarkSegment(containing ? 10000 : 1000, containing, wide);
      struct timespec before, after;
      clock_gettime(CLOCK_MONOTONIC, &before);
      double checksum = benchmarkSegment(iterations, containing, wide);
      clock_gettime(CLOCK_MONOTONIC, &after);
      printf("{\"backend\":\"c-rc\",\"mode\":\"segment-%s\",\"text\":\"%s\",\"checksum\":%.0f,\"nsPerOperation\":%.3f}\n",
        containing ? "containing" : "iterate", wide ? "wide" : "latin1", checksum,
        ((after.tv_sec - before.tv_sec) * 1e9 + after.tv_nsec - before.tv_nsec) / iterations);
      return 0;
    }
    if (argc > 2 && strcmp(argv[2], "display") == 0) {
      bool fields = argc > 3 && strcmp(argv[3], "fields") == 0;
      (void)benchmarkDisplay(10000, fields);
      struct timespec before, after;
      clock_gettime(CLOCK_MONOTONIC, &before);
      double checksum = benchmarkDisplay(iterations, fields);
      clock_gettime(CLOCK_MONOTONIC, &after);
      printf("{\"backend\":\"c-rc\",\"mode\":\"display-names\",\"type\":\"%s\",\"checksum\":%.0f,\"nsPerCall\":%.3f}\n", fields ? "fields" : "currency", checksum,
        ((after.tv_sec - before.tv_sec) * 1e9 + after.tv_nsec - before.tv_nsec) / iterations);
      return 0;
    }
    if (argc > 2 && strcmp(argv[2], "supported") == 0) {
      const bool time_zones = argc > 3 && strcmp(argv[3], "timeZone") == 0;
      (void)benchmarkSupported(10000, time_zones);
      struct timespec from, to;
      clock_gettime(CLOCK_MONOTONIC, &from);
      double checksum = benchmarkSupported(iterations, time_zones);
      clock_gettime(CLOCK_MONOTONIC, &to);
      double elapsed = (double)(to.tv_sec - from.tv_sec) * 1e9 + (double)(to.tv_nsec - from.tv_nsec);
      printf("{\"backend\":\"c-rc\",\"mode\":\"supported-values\",\"key\":\"%s\",\"nsPerCall\":%.3f,\"checksum\":%.0f}\n", time_zones ? "timeZone" : "numberingSystem", elapsed / iterations, checksum);
      return 0;
    }
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
