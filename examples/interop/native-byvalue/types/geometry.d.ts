/**
 * The records of `native/geometry.h`, which C passes and returns by value.
 *
 * @ntsHeader "geometry.h"
 */
declare module "c:geometry" {
  import type { ByValue, Struct, c_char, c_double, c_int, c_long } from "c:types";

  export type Point = Struct<{ x: c_double; y: c_double }, "point">;
  export type Rect = Struct<{ origin: Point; size: Point }, "rect">;
  export type Tagged = Struct<{ kind: c_int; code: c_char }, "tagged">;
  export type Wide = Struct<{ a: c_long; b: c_long; c: c_long }, "wide">;

  export function point_add(a: ByValue<Point>, b: ByValue<Point>): ByValue<Point>;
  export function rect_make(x: c_double, y: c_double, width: c_double, height: c_double): ByValue<Rect>;
  export function rect_area(r: ByValue<Rect>): c_double;
  export function rect_inset(r: ByValue<Rect>, by: c_double): ByValue<Rect>;
  export function tagged_next(t: ByValue<Tagged>): ByValue<Tagged>;
  export function wide_add(w: ByValue<Wide>, k: c_long): ByValue<Wide>;
  export function mixed(
    a: ByValue<Rect>,
    p: ByValue<Point>,
    scale: c_double,
    t: ByValue<Tagged>,
    w: ByValue<Wide>,
  ): c_double;
}
