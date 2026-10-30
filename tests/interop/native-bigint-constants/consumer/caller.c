#include "program.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
  assert(positive());
  assert(positiveControl());
  assert(negative());
  assert(negativeControl());
  assert(signedMin());
  assert(signedMinControl());
  assert(signedMax());
  assert(signedMaxControl());
  assert(unsignedMax());
  assert(unsignedMaxControl());
  puts("bigint constants: exact signed and unsigned C values");
  return 0;
}
