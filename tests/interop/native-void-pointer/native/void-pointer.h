#ifndef NTS_VOID_POINTER_H
#define NTS_VOID_POINTER_H
#include <stdint.h>
uint8_t *vp_bytes(void);
void *vp_address(int present);
const void *vp_const_address(int present);
void vp_fill(void **out, int present);
void vp_const_fill(const void **out, int present);
#endif
