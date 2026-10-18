#include "atoms.h"
#include <stddef.h>
// Check the tag bits before reading memory, just as IS_INTRESOURCE requires.
int accept_name(const uint16_t *name) {
  uintptr_t bits = (uintptr_t)name;
  return bits <= UINT16_MAX ? (int)bits : (int)name[0];
}
