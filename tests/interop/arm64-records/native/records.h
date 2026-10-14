/* Records by value, one of each shape AAPCS64 places differently: the
 * homogeneous floating-point aggregates AppKit's geometry is (one to four
 * doubles, nested as `CGRect` nests them), sixteen and eight bytes of
 * integers, and the results that come back an integer of their own width or
 * through `sret`. */
#ifndef RECORDS_H
#define RECORDS_H
#include <stdint.h>

typedef struct Point { double x; double y; } Point;
typedef struct Size { double width; double height; } Size;
typedef struct Rect { Point origin; Size size; } Rect;
typedef struct One { double value; } One;
typedef struct Three { double a; double b; double c; } Three;
typedef struct Range { uint64_t location; uint64_t length; } Range;
typedef struct Pair { int32_t a; int32_t b; } Pair;
typedef struct Mixed { int32_t a; double b; } Mixed;
typedef struct Rgb { uint8_t r; uint8_t g; uint8_t b; } Rgb;
typedef struct Transform { double m[6]; } Transform;
typedef struct FloatPair { float x; float y; } FloatPair;

Rect rect_offset(Rect r, Point by);
Point rect_center(Rect r);
One one_twice(One v);
Three three_sum(Three a, Three b);
Range range_shift(Range r, uint64_t by);
Pair pair_swap(Pair p);
Mixed mixed_scale(Mixed m, int32_t by);
Rgb rgb_make(int32_t r, int32_t g, int32_t b);
Transform transform_scale(double sx, double sy);
FloatPair float_pair(float x, float y);
/* Twelve doubles: past the eight SIMD argument registers, so the third
 * rectangle goes on the stack whole. */
double rects_area(Rect a, Rect b, Rect c);
void report(const char *line);

#endif
