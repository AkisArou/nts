/* Records that cross by value, one per way an ABI passes them.
 *
 * - `point`, two doubles: two SSE registers on x86_64, an HFA on arm64.
 * - `rect`, four doubles: memory on x86_64 (a hidden pointer for the result,
 *   a stack copy for an argument), an HFA of four on arm64.
 * - `tagged`, an int and a char: one integer register.
 * - `wide`, three longs: memory on x86_64, indirect on arm64. */
#ifndef GEOMETRY_H
#define GEOMETRY_H

struct point { double x; double y; };
struct rect { struct point origin; struct point size; };
struct tagged { int kind; char code; };
struct wide { long a; long b; long c; };

struct point point_add(struct point a, struct point b);
struct rect rect_make(double x, double y, double width, double height);
double rect_area(struct rect r);
/* Changes its own copy and returns it: the caller's must not follow. */
struct rect rect_inset(struct rect r, double by);
struct tagged tagged_next(struct tagged t);
struct wide wide_add(struct wide w, long k);
/* More arguments than registers, records among them. */
double mixed(struct rect a, struct point p, double scale, struct tagged t, struct wide w);

#endif
