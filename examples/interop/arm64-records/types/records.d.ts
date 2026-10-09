// Hand-written, one declaration per function in native/records.h.
/**
 * @ntsHeader "records.h"
 */
declare module "c:records" {
  import type { ByValue, CArray, Struct } from "c:types";
  import type { Float64, Float32, c_int, BigUint64, Uint8 } from "@nts/scalars";
  export type Point = Struct<{ x: Float64; y: Float64 }, "Point">;
  export type Size = Struct<{ width: Float64; height: Float64 }, "Size">;
  export type Rect = Struct<{ origin: Point; size: Size }, "Rect">;
  export type One = Struct<{ value: Float64 }, "One">;
  export type Three = Struct<{ a: Float64; b: Float64; c: Float64 }, "Three">;
  export type Range = Struct<{ location: BigUint64; length: BigUint64 }, "Range">;
  export type Pair = Struct<{ a: c_int; b: c_int }, "Pair">;
  export type Mixed = Struct<{ a: c_int; b: Float64 }, "Mixed">;
  export type Rgb = Struct<{ r: Uint8; g: Uint8; b: Uint8 }, "Rgb">;
  export type Transform = Struct<{ m: CArray<Float64, 6> }, "Transform">;
  export type FloatPair = Struct<{ x: Float32; y: Float32 }, "FloatPair">;

  export function rect_offset(r: ByValue<Rect>, by: ByValue<Point>): ByValue<Rect>;
  export function rect_center(r: ByValue<Rect>): ByValue<Point>;
  export function one_twice(v: ByValue<One>): ByValue<One>;
  export function three_sum(a: ByValue<Three>, b: ByValue<Three>): ByValue<Three>;
  export function range_shift(r: ByValue<Range>, by: BigUint64): ByValue<Range>;
  export function pair_swap(p: ByValue<Pair>): ByValue<Pair>;
  export function mixed_scale(m: ByValue<Mixed>, by: c_int): ByValue<Mixed>;
  export function rgb_make(r: c_int, g: c_int, b: c_int): ByValue<Rgb>;
  export function transform_scale(sx: Float64, sy: Float64): ByValue<Transform>;
  export function float_pair(x: Float32, y: Float32): ByValue<FloatPair>;
  export function rects_area(a: ByValue<Rect>, b: ByValue<Rect>, c: ByValue<Rect>): Float64;
  export function report(line: string): void;
}
