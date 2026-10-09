#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

double answer(int32_t which);
void walk(int32_t which);

static int failed;

static void check(const char *what, double got, double want) {
  if (got != want) {
    printf("FAIL %s: got %.17g want %.17g\n", what, got, want);
    failed = 1;
  }
}

/* No argument: the results. One: `walk` with it, which C's callback stops
   for past 2^53. */
int main(int argc, char **argv) {
  if (argc > 1) {
    walk(atoi(argv[1]));
    return 0;
  }
  check("42", answer(0), 42);
  check("2^53", answer(1), 9007199254740992.0);
  check("2^60 throws", answer(2), -1);
  check("-2^60 throws", answer(3), -1);
  return failed;
}
