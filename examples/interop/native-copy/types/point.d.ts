/**
 * A separately compiled C library, bound so that `copy` has something with
 * nesting and an inline array to move.
 *
 * @ntsHeader "point.h"
 */
declare module "c:point" {
  import type { CArray, ConstPtr, Ptr, Struct, c_double, c_int32, c_uint8 } from "c:types";

  export type Pair = Struct<{ x: c_int32; y: c_int32 }, "pair">;
  export type Sample = Struct<{
    origin: Pair;
    extent: Pair;
    label: CArray<c_uint8, 8>;
    weight: c_double;
  }, "sample">;

  /** Writes the caller's storage and keeps no address into it.
   * @ntsNoEscape s */
  export function sample_fill(s: Ptr<Sample>, seed: c_int32): void;
  /** Reads both and keeps neither.
   * @ntsNoEscape a b */
  export function sample_equal(a: ConstPtr<Sample>, b: ConstPtr<Sample>): c_int32;
}
