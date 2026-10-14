#include "point.h"

void sample_fill(struct sample *s, int32_t seed) {
  s->origin.x = seed;
  s->origin.y = seed + 1;
  s->extent.x = seed * 2;
  s->extent.y = seed * 3;
  for (int i = 0; i < 8; i++) s->label[i] = (uint8_t)(seed + i);
  s->weight = (double)seed / 4.0;
}

int sample_equal(const struct sample *a, const struct sample *b) {
  if (a->origin.x != b->origin.x || a->origin.y != b->origin.y) return 0;
  if (a->extent.x != b->extent.x || a->extent.y != b->extent.y) return 0;
  for (int i = 0; i < 8; i++) if (a->label[i] != b->label[i]) return 0;
  return a->weight == b->weight;
}
