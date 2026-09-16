#include "counter.h"
#include "program.h"
#include <stdio.h>

int main(void) {
  if (clamped(3.75) != 3.25 || clamped(-1) != 0.25 || clamped(20) != 10.25)
    return 1;
  if (roundTrip(3.75) != 5.25 || roundTrip(-1) != -1)
    return 2;
  if (counter_live() != 0)
    return 3;
  puts("scalar conversions, opaque handles, null, and cleanup: OK");
  return 0;
}
