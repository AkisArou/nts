/* The oracle: `src/main.ts` written in C, where clang decides every copy. */
#include <stdio.h>

#include "geometry.h"

int main(void) {
  struct rect r = rect_make(1, 2, 10, 20);
  printf("rect %g %g %g %g area %g\n", r.origin.x, r.origin.y, r.size.x, r.size.y, rect_area(r));

  struct rect inset = rect_inset(r, 1);
  printf("inset %g %g %g %g\n", inset.origin.x, inset.origin.y, inset.size.x, inset.size.y);
  printf("unchanged %g %g\n", r.origin.x, r.size.x);
  r.size.x = 100;
  printf("result kept %g area now %g\n", inset.size.x, rect_area(r));

  struct point a = {1.5, -2};
  struct point b = {0.25, 8};
  struct point sum = point_add(a, b);
  printf("point %g %g\n", sum.x, sum.y);

  struct tagged t = {41, 64};
  struct tagged next = tagged_next(t);
  printf("tagged %d %d\n", next.kind, next.code);

  struct wide w = {1, 2, 3};
  struct wide wider = wide_add(w, 1000);
  printf("wide %ld %ld %ld\n", wider.a, wider.b, wider.c);

  printf("mixed %g\n", mixed(r, sum, 2, next, wider));
  return 0;
}
