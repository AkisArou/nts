#include "void-pointer.h"
#include "program.h"
#include <assert.h>
#include <stddef.h>
#include <stdio.h>

int main(void) {
  assert(typedToVoid() == vp_bytes());
  assert(typedControl() == vp_bytes());
  for (int present = 0; present <= 1; ++present) {
    assert(returned(present) == vp_address(present));
    assert(constReturned(present) == vp_const_address(present));
    assert(output(present) == vp_address(present));
    assert(constOutput(present) == vp_const_address(present));
    assert(isNull(present) == (vp_address(present) == NULL));
  }
  puts("void pointers: identity, null and both output-slot qualifiers agree with C");
  return 0;
}
