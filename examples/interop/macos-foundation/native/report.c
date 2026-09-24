#include "report.h"

#include <stdio.h>

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}
