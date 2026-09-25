// Records by value across C calls, printed one line each. Built for arm64
// Linux by both backends and run under qemu: the C backend's lines are
// clang's ABI by construction, and the LLVM backend's must be the same.
//
// The shapes are the ones `aggregate::aapcs64` names: homogeneous
// floating-point aggregates (AppKit's geometry), eight and sixteen bytes of
// integers, results of their own width and through `sret`, and a third
// rectangle past the eight SIMD argument registers.
import {
  float_pair,
  mixed_scale,
  one_twice,
  pair_swap,
  range_shift,
  rect_center,
  rect_offset,
  rects_area,
  report,
  rgb_make,
  three_sum,
  transform_scale,
  type Mixed,
  type One,
  type Pair,
  type Point,
  type Range,
  type Rect,
  type Three,
} from "c:records";
import { local } from "c:memory";
import type { Ptr, c_double, c_float, c_int, c_uint64 } from "c:types";

function setRect(r: Ptr<Rect>, x: number, y: number, width: number, height: number): void {
  r.origin.x = x;
  r.origin.y = y;
  r.size.width = width;
  r.size.height = height;
}

function main(): void {
  const r = local<Rect>();
  setRect(r, 1, 2, 30, 40);
  const by = local<Point>();
  by.x = 0.5;
  by.y = -2;
  const moved = rect_offset(r, by);
  report(`offset ${moved.origin.x} ${moved.origin.y} ${moved.size.width} ${moved.size.height}`);
  const center = rect_center(r);
  report(`center ${center.x} ${center.y}`);

  const one = local<One>();
  one.value = 21.25;
  report(`one ${one_twice(one).value}`);

  const a = local<Three>();
  a.a = 1;
  a.b = 2;
  a.c = 3;
  const b = local<Three>();
  b.a = 10;
  b.b = 20;
  b.c = 30;
  const sum = three_sum(a, b);
  report(`three ${sum.a} ${sum.b} ${sum.c}`);

  const range = local<Range>();
  range.location = 5n as c_uint64;
  range.length = 7n as c_uint64;
  const shifted = range_shift(range, 100n as c_uint64);
  report(`range ${shifted.location} ${shifted.length}`);

  const pair = local<Pair>();
  pair.a = 3 as c_int;
  pair.b = -4 as c_int;
  const swapped = pair_swap(pair);
  report(`pair ${swapped.a} ${swapped.b}`);

  const mixed = local<Mixed>();
  mixed.a = 6 as c_int;
  mixed.b = 1.5;
  const scaled = mixed_scale(mixed, 3 as c_int);
  report(`mixed ${scaled.a} ${scaled.b}`);

  const colour = rgb_make(250 as c_int, 128 as c_int, 7 as c_int);
  report(`rgb ${colour.r} ${colour.g} ${colour.b}`);

  const transform = transform_scale(2 as c_double, 3 as c_double);
  report(`transform ${transform.m[0]} ${transform.m[3]} ${transform.m[5]}`);

  const floats = float_pair(0.5 as c_float, 0.25 as c_float);
  report(`floats ${floats.x} ${floats.y}`);

  const small = local<Rect>();
  setRect(small, 0, 0, 2, 3);
  const middle = local<Rect>();
  setRect(middle, 0, 0, 4, 5);
  const large = local<Rect>();
  setRect(large, 0, 0, 6, 7);
  report(`area ${rects_area(small, middle, large)}`);
}

main();
