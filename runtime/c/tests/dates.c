/* A date is a double, and every answer here is arithmetic on it.
 *
 * `TimeClip` is the whole of what a `Date` does to its argument, and every
 * expected value below was read off node. Both halves of it are observable:
 * truncation toward zero makes `new Date(1.5).getTime()` 1, and the range check
 * makes `new Date(8.64e15 + 1).getTime()` NaN rather than a large number.
 *
 * `toISOString` is *not* here, and that is deliberate rather than an omission.
 * It throws a RangeError on an invalid date and a runtime helper here has no
 * way to throw, so the lowering refuses it by name -- and the calendar that
 * would implement it is not carried unreached.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "nts_runtime.h"

static int failures;
static int checks;

static void ok(const char *what, int holds) {
  checks++;
  if (holds) {
    printf("ok %s\n", what);
    return;
  }
  printf("FAIL %s\n", what);
  failures++;
}

/* `TimeClip`: truncated toward zero, and NaN outside the range. */
static void the_constructor_normalises(void) {
  ok("a whole millisecond is itself",
     nts_date_value(nts_date_new(1234.0)) == 1234.0);
  ok("a fraction truncates toward zero",
     nts_date_value(nts_date_new(1.9)) == 1.0);
  ok("and truncates toward zero when negative",
     nts_date_value(nts_date_new(-1.9)) == -1.0);
  ok("the epoch is zero", nts_date_value(nts_date_new(0.0)) == 0.0);
  /* -0 and +0 are one time value. */
  ok("negative zero is zero", 1.0 / nts_date_value(nts_date_new(-0.0)) > 0);

  /* The range is 100,000,000 days either side, inclusive. */
  ok("the last representable instant is representable",
     nts_date_value(nts_date_new(8.64e15)) == 8.64e15);
  ok("and one past it is not",
     isnan(nts_date_value(nts_date_new(8.64e15 + 1.0))));
  ok("the first is representable",
     nts_date_value(nts_date_new(-8.64e15)) == -8.64e15);
  ok("and one before it is not",
     isnan(nts_date_value(nts_date_new(-8.64e15 - 1.0))));
  ok("NaN in, NaN out", isnan(nts_date_value(nts_date_new((double)NAN))));
  ok("infinity is out of range",
     isnan(nts_date_value(nts_date_new((double)INFINITY))));
}

int main(void) {
  the_constructor_normalises();
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
