/* Links the archive the ordinary way -- no --whole-archive. That is the whole
   point: the constructor has to arrive because `program.c.o` was pulled in for
   `total`, not because the link was told to take every member. */
#include <stdio.h>
#include "program.h"

int main(void) {
  double got = total();
  printf("total=%g\n", got);
  if (got != 12.0) {
    fprintf(stderr, "module evaluation did not run: expected 12, got %g\n", got);
    return 1;
  }
  return 0;
}
