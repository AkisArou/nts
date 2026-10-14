/**
 * A separately compiled C library, bound so that `copy` has something with
 * nesting and an inline array to move.
 *
 * @ntsHeader "point.h"
 */
declare module "c:point" {
  import type { CArray, ConstPtr, Ptr, Struct } from "c:types";
  import type { Float64, Int32, Uint8 } from "@nts/scalars";

  export type Pair = Struct<{ x: Int32; y: Int32 }, "pair">;
  export type Sample = Struct<{
    origin: Pair;
    extent: Pair;
    label: CArray<Uint8, 8>;
    weight: Float64;
  }, "sample">;

  /** Writes the caller's storage and keeps no address into it.
   * @ntsNoEscape s */
  export function sample_fill(s: Ptr<Sample>, seed: Int32): void;
  /** Reads both and keeps neither.
   * @ntsNoEscape a b */
  export function sample_equal(a: ConstPtr<Sample>, b: ConstPtr<Sample>): Int32;
}
