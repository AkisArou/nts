// Fifty rounds of `subject`, `temporary` or `control`, as argv[1] names, each
// checked against the units C should read: 'k' * 40 + 'p' + 'x'.
#include "program.h"
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  module__init();
  const char *which = argc > 1 ? argv[1] : "control";
  for (int i = 0; i < 50; i++) {
    double got = strcmp(which, "subject") == 0     ? subject(40)
                 : strcmp(which, "temporary") == 0 ? temporary(40)
                                                   : control(40);
    if (got != 107 * 40 + 112 + 120) {
      printf("wrong: %.0f\n", got);
      return 1;
    }
  }
  puts("a lent string view outlives the call that reads it");
  return 0;
}
