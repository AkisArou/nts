// Hand-written, one declaration per function in native/records.h.
/**
 * @ntsHeader "records.h"
 */
declare module "c:records" {
  import type { ByValue, CArray, Struct, c_double, c_float, c_int, c_uint64, c_uint8 } from "c:types";
  export type Point = Struct<{ x: c_double; y: c_double }, "Point">;
  export type Size = Struct<{ width: c_double; height: c_double }, "Size">;
  export type Rect = Struct<{ origin: Point; size: Size }, "Rect">;
  export type One = Struct<{ value: c_double }, "One">;
  export type Three = Struct<{ a: c_double; b: c_double; c: c_double }, "Three">;
  export type Range = Struct<{ location: c_uint64; length: c_uint64 }, "Range">;
  export type Pair = Struct<{ a: c_int; b: c_int }, "Pair">;
  export type Mixed = Struct<{ a: c_int; b: c_double }, "Mixed">;
  export type Rgb = Struct<{ r: c_uint8; g: c_uint8; b: c_uint8 }, "Rgb">;
  export type Transform = Struct<{ m: CArray<c_double, 6> }, "Transform">;
  export type FloatPair = Struct<{ x: c_float; y: c_float }, "FloatPair">;

  export function rect_offset(r: ByValue<Rect>, by: ByValue<Point>): ByValue<Rect>;
  export function rect_center(r: ByValue<Rect>): ByValue<Point>;
  export function one_twice(v: ByValue<One>): ByValue<One>;
  export function three_sum(a: ByValue<Three>, b: ByValue<Three>): ByValue<Three>;
  export function range_shift(r: ByValue<Range>, by: c_uint64): ByValue<Range>;
  export function pair_swap(p: ByValue<Pair>): ByValue<Pair>;
  export function mixed_scale(m: ByValue<Mixed>, by: c_int): ByValue<Mixed>;
  export function rgb_make(r: c_int, g: c_int, b: c_int): ByValue<Rgb>;
  export function transform_scale(sx: c_double, sy: c_double): ByValue<Transform>;
  export function float_pair(x: c_float, y: c_float): ByValue<FloatPair>;
  export function rects_area(a: ByValue<Rect>, b: ByValue<Rect>, c: ByValue<Rect>): c_double;
  export function report(line: string): void;
}
