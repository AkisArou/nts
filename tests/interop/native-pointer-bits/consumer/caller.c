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
    assert(bits(p) == (uintptr_t)p);
    assert(isIntResource(p) == IS_INTRESOURCE(p));
    assert(atom(p) == (double)((uintptr_t)p & 0xffff));
  }
  assert(isIntResource(NULL) && atom(NULL) == 0.0);
  assert(isIntResource(AT(65535)) && !isIntResource(AT(65536)));

  uint16_t stack[4] = {0};
  assert(mutableBits(stack) == (uintptr_t)stack);
  assert(mutableBits(&stack[3]) - mutableBits(stack) == 3 * sizeof stack[0]);
  assert(!isIntResource(stack));

  void *heap = malloc(32);
  assert(heap != NULL);
  assert(itemBits((struct Item *)heap) == (uintptr_t)heap);
  free(heap);

  assert(windowBits((struct Window *)(uintptr_t)UINTPTR_MAX) == UINTPTR_MAX);
  assert(windowBits(NULL) == 0);
  assert(nullBits() == 0);
  assert(textBits() == (uintptr_t)bits_text());
  assert(bits(bits_text()) == (uintptr_t)bits_text());
  assert(stride() == 4.0);
  assert(heapStride() == 2.0);
  puts("native pointer bits: exact bits, no load, agree with C's (uintptr_t)p");
  return 0;
}
