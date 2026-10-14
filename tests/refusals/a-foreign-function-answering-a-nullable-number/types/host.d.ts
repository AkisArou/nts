/** @ntsHeader "host.h" */
declare module "host" {
  import type { Float64, Int32 } from "@nts/scalars";
  /** Where the text selection starts, or null for an input that has none. */
  export function selection_start(input: Int32): Float64 | null;
}
