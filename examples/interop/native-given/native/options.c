#include "options.h"

#include <stdio.h>

void options_report(const char *label, struct options options) {
  printf("%s: keepalive ", label);
  if (options.keepalive.given) {
    printf("given %s", options.keepalive.value ? "true" : "false");
  } else {
    printf("not given (value %u)", (unsigned)options.keepalive.value);
  }
  printf(", priority ");
  if (options.priority.given) {
    printf("given %g", options.priority.value);
  } else {
    printf("not given (value %g)", options.priority.value);
  }
  printf(", plain %d\n", (int)options.plain);
  fflush(stdout);
}
