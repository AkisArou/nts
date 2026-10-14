#include "tasks.h"

#include <stdio.h>
#include <time.h>

double tasks_now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6;
}

void tasks_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
