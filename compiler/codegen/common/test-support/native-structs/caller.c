#include "program.h"
size_t c_size(void);
size_t c_offset(void);
double c_read(struct NativeState *p);
_Static_assert(sizeof(struct NativeState) == 32, "size");
_Static_assert(_Alignof(struct NativeState) == 8, "alignment");
_Static_assert(offsetof(struct NativeState, total) == 8,
               "padding before double");
_Static_assert(offsetof(struct NativeState, count) == 16, "uint16 slot");
_Static_assert(offsetof(struct NativeState, data) == 24, "pointer slot");
int main(void) {
  uint8_t data[3] = {11, 22, 33};
  struct NativeState states[2] = {{17, 0, 0, -99, data}, {19, 0, 0, -88, 0}};
  if (c_size() != sizeof states[0] ||
      c_offset() != offsetof(struct NativeState, data))
    return 1;
  if (run(states) != 619.5 || c_read(states) != 520.5)
    return 2;
  if (states[0].marker != 17 || states[0].tail != -99 ||
      states[0].data != data + 1)
    return 3;
  if (states[1].marker != 19 || states[1].total != 3.25 ||
      states[1].tail != -88)
    return 4;
  if (data[0] != 11 || data[1] != 99 || data[2] != 33)
    return 5;
  struct KeyState keys = {11, 17};
  if (computedKey(&keys) != 1728 || keys.key != 11 || keys.count != 25)
    return 6;
  return 0;
}
