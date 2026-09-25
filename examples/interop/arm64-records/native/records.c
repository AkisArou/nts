#include "records.h"
#include <stdio.h>

Rect rect_offset(Rect r, Point by) {
  r.origin.x += by.x;
  r.origin.y += by.y;
  return r;
}
Point rect_center(Rect r) {
  Point p = { r.origin.x + r.size.width / 2, r.origin.y + r.size.height / 2 };
  return p;
}
One one_twice(One v) { One o = { v.value * 2 }; return o; }
Three three_sum(Three a, Three b) { Three t = { a.a + b.a, a.b + b.b, a.c + b.c }; return t; }
Range range_shift(Range r, uint64_t by) { r.location += by; return r; }
Pair pair_swap(Pair p) { Pair q = { p.b, p.a }; return q; }
Mixed mixed_scale(Mixed m, int32_t by) { m.a *= by; m.b *= by; return m; }
Rgb rgb_make(int32_t r, int32_t g, int32_t b) { Rgb c = { (uint8_t)r, (uint8_t)g, (uint8_t)b }; return c; }
Transform transform_scale(double sx, double sy) { Transform t = { { sx, 0, 0, sy, 0, 0 } }; return t; }
FloatPair float_pair(float x, float y) { FloatPair p = { x, y }; return p; }
double rects_area(Rect a, Rect b, Rect c) {
  return a.size.width * a.size.height + b.size.width * b.size.height + c.size.width * c.size.height;
}
void report(const char *line) { puts(line); }
