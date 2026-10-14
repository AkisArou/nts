// A library's own type, with nesting so a copy has to move more than one word
// and inline arrays so it has to move more than one member.
#ifndef NTS_EXAMPLE_POINT_H
#define NTS_EXAMPLE_POINT_H
#include <stdint.h>

struct pair { int32_t x; int32_t y; };

struct sample {
  struct pair origin;
  struct pair extent;
  uint8_t label[8];
  double weight;
};

void sample_fill(struct sample *s, int32_t seed);
int sample_equal(const struct sample *a, const struct sample *b);
#endif
