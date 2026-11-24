// Independent C reference: every answer is C's own `(uintptr_t)p`, and an
// address that is not one is never read through -- a load from any of these
// would fault, so a run that finishes is the no-dereference proof.
#include "bits.h"
#include "program.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define AT(n) ((const uint16_t *)(uintptr_t)(n))
// winuser.h's own definition.
#define IS_INTRESOURCE(r) ((((uintptr_t)(r)) >> 16) == 0)

int main(void) {
  static const uintptr_t odd[] = {
      0, 1, 65535, 65536, UINT64_C(0x8000000000000000), UINTPTR_MAX,
  };
  for (size_t i = 0; i < sizeof odd / sizeof odd[0]; i++) {
    const uint16_t *p = AT(odd[i]);
    assert(lib_bits(p) == (uintptr_t)p);
    assert(lib_isIntResource(p) == IS_INTRESOURCE(p));
    assert(lib_atom(p) == (double)((uintptr_t)p & 0xffff));
  }
  assert(lib_isIntResource(NULL) && lib_atom(NULL) == 0.0);
  assert(lib_isIntResource(AT(65535)) && !lib_isIntResource(AT(65536)));

  uint16_t stack[4] = {0};
  assert(lib_mutableBits(stack) == (uintptr_t)stack);
  assert(lib_mutableBits(&stack[3]) - lib_mutableBits(stack) == 3 * sizeof stack[0]);
  assert(!lib_isIntResource(stack));

  void *heap = malloc(32);
  assert(heap != NULL);
  assert(lib_itemBits((struct Item *)heap) == (uintptr_t)heap);
  free(heap);

  assert(lib_windowBits((struct Window *)(uintptr_t)UINTPTR_MAX) == UINTPTR_MAX);
  assert(lib_windowBits(NULL) == 0);
  assert(lib_nullBits() == 0);
  assert(lib_textBits() == (uintptr_t)bits_text());
  assert(lib_bits(bits_text()) == (uintptr_t)bits_text());
  assert(lib_stride() == 4.0);
  assert(lib_heapStride() == 2.0);
  puts("native pointer bits: exact bits, no load, agree with C's (uintptr_t)p");
  return 0;
}
