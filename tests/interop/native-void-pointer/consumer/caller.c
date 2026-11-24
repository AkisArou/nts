#include "void-pointer.h"
#include "program.h"
#include <assert.h>
#include <stddef.h>
#include <stdio.h>

int main(void) {
  assert(lib_typedToVoid() == vp_bytes());
  assert(lib_typedControl() == vp_bytes());
  assert(lib_genericVoid() == vp_address(1));
  assert(lib_copiedByte() == vp_bytes()[1]);
  for (int present = 0; present <= 1; ++present) {
    assert(lib_returned(present) == vp_address(present));
    assert(lib_constReturned(present) == vp_const_address(present));
    assert(lib_output(present) == vp_address(present));
    assert(lib_constOutput(present) == vp_const_address(present));
    assert(lib_isNull(present) == (vp_address(present) == NULL));
  }
  puts("void pointers: identity, null and both output-slot qualifiers agree with C");
  return 0;
}
