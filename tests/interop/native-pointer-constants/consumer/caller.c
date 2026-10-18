// Independent C reference: integer-to-pointer constants are never dereferenced.
#include "constants.h"
#include "program.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/mman.h>

int main(void) {
  assert((uintptr_t)broadcast() == (uintptr_t)65535);
  assert(numberControl() == 65535.0);
  assert((uintptr_t)resource() == (uintptr_t)32512);
  assert((uintptr_t)readonlyPointer() == (uintptr_t)3);
  assert((uintptr_t)voidPointer() == (uintptr_t)7);
  assert((uintptr_t)zero() == (uintptr_t)0);
  assert((void *)failed() == MAP_FAILED);
  assert((uintptr_t)negativeTwo() == UINTPTR_MAX - 1);
  assert((uintptr_t)negativeThree() == UINTPTR_MAX - 2);
  assert((uintptr_t)wide() == UINT64_C(9007199254740993));
  assert((uintptr_t)highBit() == UINT64_C(0x8000000000000000));
  assert((uintptr_t)allBits() == UINTPTR_MAX);
  assert(nativeArgument());
  assert(returnedEquals(1));
  assert(!returnedEquals(0));
  assert((uintptr_t)localAlias() == UINT64_C(9007199254740993));
  assert((uintptr_t)shorthand() == UINT64_C(9007199254740993));
  puts("native pointer constants: exact bits, typed calls and equality agree "
       "with C");
  return 0;
}
