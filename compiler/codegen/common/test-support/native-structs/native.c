#include <stddef.h>
#include <stdint.h>
struct NativeState {
  uint8_t marker;
  double total;
  uint16_t count;
  int32_t tail;
  uint8_t *data;
};
void stamp(uint16_t *p) { *p = 513; }
size_t c_size(void) { return sizeof(struct NativeState); }
size_t c_offset(void) { return offsetof(struct NativeState, data); }
double c_read(struct NativeState *p) { return p->total + p->count; }
