#include "adw.h"

#include <stdio.h>

void adw_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}
