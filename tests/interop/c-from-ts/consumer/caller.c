#include "counter.h"
#include "program.h"
#include <stdio.h>

int main(void) {
  /* `n: c_int` in TypeScript is `int32_t n` here: a C caller passes C's
     `int`, converting what it has as C converts any argument. */
  if (clamped(3) != 3.25 || clamped(-1) != 0.25 || clamped(20) != 10.25)
    return 1;
  if (clamped((int32_t)3.75) != 3.25)
    return 4;
  if (roundTrip(3) != 5.25 || roundTrip(-1) != -1)
    return 2;
  if (counter_live() != 0)
    return 3;
  puts("scalar conversions, opaque handles, null, and cleanup: OK");
  return 0;
}
