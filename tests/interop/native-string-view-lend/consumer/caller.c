// Fifty rounds of `subject` or `control`, as argv[1] names, each checked
// against the units C should read: 'k' * 40 + 'p' + 'x'.
#include "program.h"
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  module__init();
  int subject_run = argc > 1 && strcmp(argv[1], "subject") == 0;
  for (int i = 0; i < 50; i++) {
    double got = subject_run ? subject(40) : control(40);
    if (got != 107 * 40 + 112 + 120) {
      printf("wrong: %.0f\n", got);
      return 1;
    }
  }
  puts("a lent string view outlives the call that reads it");
  return 0;
}
