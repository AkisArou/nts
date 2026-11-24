#include "program.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
  assert(lib_positive());
  assert(lib_positiveControl());
  assert(lib_negative());
  assert(lib_negativeControl());
  assert(lib_signedMin());
  assert(lib_signedMinControl());
  assert(lib_signedMax());
  assert(lib_signedMaxControl());
  assert(lib_unsignedMax());
  assert(lib_unsignedMaxControl());
  puts("bigint constants: exact signed and unsigned C values");
  return 0;
}
