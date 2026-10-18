#include "constants.h"

struct Sentinel *sentinel_from(int failed) {
  return (struct Sentinel *)(failed ? UINTPTR_MAX : (uintptr_t)17);
}

bool sentinel_is_broadcast(struct Window *value) {
  return (uintptr_t)value == (uintptr_t)65535;
}
