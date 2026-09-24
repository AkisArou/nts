#include "support.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nts_cf_host.h"

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void window_control(void) {
  const char *control = getenv("WINDOW_CONTROL");
  if (control != NULL && strcmp(control, "detached") == 0)
    nts_cf_host_detach();
}
