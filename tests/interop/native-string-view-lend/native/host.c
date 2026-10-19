#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "nts_string_view.h"
static int sum(const NtsBorrowedString *s) {
  NtsStringView v = nts_string_view(s);
  int total = 0;
  for (uint32_t i = 0; i < v.length; i++)
    total += (v.flags & NTS_STRING_VIEW_WIDE) ? ((const uint16_t *)v.units)[i]
                                              : ((const uint8_t *)v.units)[i];
  return total;
}
int visit(const NtsBorrowedString *s, void (*before)(void)) {
  before();
  void *blocks[64];
  for (int i = 0; i < 64; i++) { blocks[i] = malloc(64); memset(blocks[i], 0xA5, 64); }
  int total = sum(s);
  for (int i = 0; i < 64; i++) free(blocks[i]);
  return total;
}
