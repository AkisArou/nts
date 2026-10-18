#ifndef NTS_POINTER_CONSTANTS_H
#define NTS_POINTER_CONSTANTS_H
#include <stdbool.h>
#include <stdint.h>
struct Sentinel;
struct Window;
struct Sentinel *sentinel_from(int failed);
bool sentinel_is_broadcast(struct Window *value);
#endif
