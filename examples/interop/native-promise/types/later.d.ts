// Hand-written. Each promise is made by the host, answered owned -- one
// reference, the program's -- and settled later, by `settle`, as a host's
// event loop would.
/**
 * @ntsHeader "later.h"
 */
declare module "c:later" {
  import type { Float64 } from "@nts/scalars";
  /** Fulfilled with `x * 2` when `settle` runs. */
  export function doubled(x: Float64): Promise<number>;
  /** Fulfilled with nothing when `settle` runs. */
  export function ready(): Promise<void>;
  /** Rejected with a `NotAllowedError` when `settle` runs. */
  export function refused(): Promise<void>;
  /** Settles every promise made so far, in the order they were made. */
  export function settle(): void;
}
