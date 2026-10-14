#include "geometry.h"

struct point point_add(struct point a, struct point b) {
  struct point sum = {a.x + b.x, a.y + b.y};
  return sum;
}

struct rect rect_make(double x, double y, double width, double height) {
  struct rect r = {{x, y}, {width, height}};
  return r;
}

double rect_area(struct rect r) { return r.size.x * r.size.y; }

struct rect rect_inset(struct rect r, double by) {
  r.origin.x += by;
  r.origin.y += by;
  r.size.x -= 2 * by;
  r.size.y -= 2 * by;
  return r;
}

struct tagged tagged_next(struct tagged t) {
  struct tagged next = {t.kind + 1, (char)(t.code + 1)};
  return next;
}

struct wide wide_add(struct wide w, long k) {
  struct wide sum = {w.a + k, w.b + k, w.c + k};
  return sum;
}

double mixed(struct rect a, struct point p, double scale, struct tagged t, struct wide w) {
  return (a.origin.x + a.size.y + p.x - p.y) * scale + t.kind + t.code + (double)(w.a - w.c);
}
