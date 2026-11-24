// Independent C reference: integer-to-pointer constants are never dereferenced.
#include "constants.h"
#include "program.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/mman.h>

int main(void) {
  assert((uintptr_t)lib_broadcast() == (uintptr_t)65535);
  assert(lib_numberControl() == 65535.0);
  assert((uintptr_t)lib_resource() == (uintptr_t)32512);
  assert((uintptr_t)lib_readonlyPointer() == (uintptr_t)3);
  assert((uintptr_t)lib_voidPointer() == (uintptr_t)7);
  assert((uintptr_t)lib_zero() == (uintptr_t)0);
  assert((void *)lib_failed() == MAP_FAILED);
  assert((uintptr_t)lib_negativeTwo() == UINTPTR_MAX - 1);
  assert((uintptr_t)lib_negativeThree() == UINTPTR_MAX - 2);
  assert((uintptr_t)lib_wide() == UINT64_C(9007199254740993));
  assert((uintptr_t)lib_highBit() == UINT64_C(0x8000000000000000));
  assert((uintptr_t)lib_allBits() == UINTPTR_MAX);
  assert(lib_nativeArgument());
  assert(lib_returnedEquals(1));
  assert(!lib_returnedEquals(0));
  assert((uintptr_t)lib_localAlias() == UINT64_C(9007199254740993));
  assert((uintptr_t)lib_namespaceAlias() == (uintptr_t)65535);
  assert(lib_zeroIsNull());
  assert(!lib_broadcastIsNull());
  assert(!lib_zeroIsTruthy());
  assert(lib_broadcastIsTruthy());
  assert((uintptr_t)lib_shorthand() == UINT64_C(9007199254740993));
  puts("native pointer constants: exact bits, typed calls and equality agree "
       "with C");
  return 0;
}
