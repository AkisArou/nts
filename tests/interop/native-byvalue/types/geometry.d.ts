/**
 * The records of `native/geometry.h`, which C passes and returns by value.
 *
 * @ntsHeader "geometry.h"
 */
declare module "c:geometry" {
  import type { ByValue, Struct } from "c:types";
  import type { c_char, Float64, c_int, c_long } from "@nts/scalars";

  export type Point = Struct<{ x: Float64; y: Float64 }, "point">;
  export type Rect = Struct<{ origin: Point; size: Point }, "rect">;
  export type Tagged = Struct<{ kind: c_int; code: c_char }, "tagged">;
  export type Wide = Struct<{ a: c_long; b: c_long; c: c_long }, "wide">;

  export function point_add(a: ByValue<Point>, b: ByValue<Point>): ByValue<Point>;
  export function rect_make(x: Float64, y: Float64, width: Float64, height: Float64): ByValue<Rect>;
  export function rect_area(r: ByValue<Rect>): Float64;
  export function rect_inset(r: ByValue<Rect>, by: Float64): ByValue<Rect>;
  export function tagged_next(t: ByValue<Tagged>): ByValue<Tagged>;
  export function wide_add(w: ByValue<Wide>, k: c_long): ByValue<Wide>;
  export function mixed(
    a: ByValue<Rect>,
    p: ByValue<Point>,
    scale: Float64,
    t: ByValue<Tagged>,
    w: ByValue<Wide>,
  ): Float64;
}
