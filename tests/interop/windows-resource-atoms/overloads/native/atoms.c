#include "atoms.h"
#include <stddef.h>
// Check the tag bits before reading memory, just as IS_INTRESOURCE requires.
int accept_name(const uint16_t *name) {
  uintptr_t bits = (uintptr_t)name;
  return bits <= UINT16_MAX ? (int)bits : (int)name[0];
}
// Hands `proc` atoms where text is expected, as EnumResourceLanguagesW does:
// none of them may be read through. NULL is atom 0.
int enumerate_names(name_proc proc, int64_t parameter) {
  static const uint16_t named[] = {'N', 'T', 'S', '_', 'N',
                                   'A', 'M', 'E', 'D', 0};
  static const uint16_t wide[] = {0x0394, 0xD83D, 0};
  int calls = 0;
  calls += proc((const uint16_t *)(uintptr_t)23, named, 1033, parameter);
  calls += proc(NULL, (const uint16_t *)(uintptr_t)1, 0, parameter);
  calls += proc(wide, (const uint16_t *)(uintptr_t)UINT16_MAX, 7, parameter);
  calls += proc(named, (const uint16_t *)(uintptr_t)32512, 1033, parameter);
  return calls;
}
