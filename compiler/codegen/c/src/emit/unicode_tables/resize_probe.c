/* Exercise the real allocator implementation, with one deterministic moving
 * realloc control. The hook changes only that allocation, never the provider
 * or production source. All other realloc calls use the host implementation. */
#define _POSIX_C_SOURCE 200809L
#define _XOPEN_SOURCE 700
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#endif
#include "nts_runtime.h"
#include <stdio.h>
#include <stdlib.h>

static void *force_block;
static unsigned forced_moves;

static void *probe_realloc(void *block, size_t bytes) {
  if (block != force_block || !force_block)
    return realloc(block, bytes);
  const size_t old_bytes = *(size_t *)block + 16u;
  void *moved = malloc(bytes);
  assert(moved);
  memcpy(moved, block, bytes < old_bytes ? bytes : old_bytes);
  free(block);
  force_block = NULL;
  forced_moves++;
  return moved;
}

#define realloc probe_realloc
#include "nts_runtime.c"
#undef realloc

static void resize(uint32_t old_length, uint32_t prefix, uint32_t length,
                   int old_wide, int wide, int intervene, int moving) {
  const size_t before = nts_live_count();
  NtsString *source = nts_str_raw(old_length, old_wide);
  for (uint32_t at = 0; at < prefix; at++) {
    uint16_t value = (uint16_t)(at + (old_wide && wide ? 0x03a3u : 65u));
    if (old_wide)
      NTS_ELEMENTS(source, uint16_t)[at] = value;
    else
      NTS_ELEMENTS(source, uint8_t)[at] = (uint8_t)value;
  }
  NtsString *guard = intervene ? nts_str_raw(16, 0) : NULL;
  const size_t objects = nts_live_count();
  const uintptr_t address = (uintptr_t)source;
  const size_t old_bytes =
      (NTS_STRING_UNITS + ((size_t)old_length + 1u) * (old_wide ? 2u : 1u) +
       15u) &
      ~(size_t)15u;
  const size_t new_bytes =
      (NTS_STRING_UNITS + ((size_t)length + 1u) * (wide ? 2u : 1u) + 15u) &
      ~(size_t)15u;
  const unsigned moves = forced_moves;
#ifdef NTS_PROVIDER_RC
  if (moving && !nts_env->region && old_bytes != new_bytes)
    force_block = (void *)(address - 16u);
#else
  (void)moving;
  (void)moves;
  (void)address;
  (void)old_bytes;
  (void)new_bytes;
#endif
  NtsString *result = nts_str_resize_owned(source, prefix, length, wide);
  assert(nts_live_count() == objects);
  assert(result->length == length);
  assert(((result->flags & NTS_TWO_BYTE) != 0) == (wide != 0));
  for (uint32_t at = 0; at < prefix; at++) {
    uint16_t value = wide ? NTS_ELEMENTS(result, uint16_t)[at]
                          : NTS_ELEMENTS(result, uint8_t)[at];
    assert(value == at + (old_wide && wide ? 0x03a3u : 65u));
  }
  assert(wide ? NTS_ELEMENTS(result, uint16_t)[length] == 0
              : NTS_ELEMENTS(result, uint8_t)[length] == 0);
#ifdef NTS_PROVIDER_RC
  if ((nts_env->region && (!intervene || new_bytes <= old_bytes)) ||
      (!nts_env->region && new_bytes == old_bytes))
    assert((uintptr_t)result == address);
  if (moving && !nts_env->region && old_bytes != new_bytes) {
    assert(forced_moves == moves + 1u);
    assert((uintptr_t)result != address);
  }
#else
  if (!intervene || new_bytes <= old_bytes)
    assert((uintptr_t)result == address);
#endif
  if (guard)
    assert(guard->length == 16);
  nts_release(result);
  nts_release(guard);
#ifdef NTS_PROVIDER_RC
  if (!nts_env->region)
    assert(nts_live_count() == before);
#else
  (void)before;
#endif
}

static void population(void) {
  for (int old_wide = 0; old_wide <= 1; old_wide++) {
    for (int wide = 0; wide <= 1; wide++) {
      for (int intervene = 0; intervene <= 1; intervene++) {
        for (uint32_t prefix = 0; prefix <= 8; prefix++) {
          resize(8, prefix, 37, old_wide, wide, intervene, 0);
          resize(37, prefix, 8, old_wide, wide, intervene, 0);
          resize(8, prefix, 8, old_wide, wide, intervene, 0);
          resize(8, prefix, 37, old_wide, wide, intervene, 1);
        }
      }
    }
  }
}

int main(void) {
  population();
#ifdef NTS_PROVIDER_RC
  const size_t before = nts_live_count();
  const size_t bytes = nts_live_bytes();
  NtsRegion *region = nts_region_open();
  population();
  nts_region_reset(region);
  assert(nts_live_count() == before);
  assert(nts_live_bytes() == bytes);
#endif
  puts("owned resize preserves prefix, width and provider bookkeeping");
}
