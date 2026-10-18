#include "void-pointer.h"
#include <stddef.h>

static uint8_t storage[] = {17, 29};
uint8_t *vp_bytes(void) { return storage; }
void *vp_address(int present) { return present ? storage : NULL; }
const void *vp_const_address(int present) { return present ? storage : NULL; }
void vp_fill(void **out, int present) { *out = vp_address(present); }
void vp_const_fill(const void **out, int present) {
  *out = vp_const_address(present);
}
