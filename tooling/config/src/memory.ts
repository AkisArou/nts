/**
 * Memory providers (RFC §6.4, §9).
 *
 * The provider is a build dimension, not a property of the runtime: HIR carries
 * abstract managed operations and the selected provider lowers them. Choosing
 * one decides whether a field store becomes a barrier.
 *
 * **Two, because the compiler has two.** `hir::Provider` is `NoGc |
 * ReferenceCounting` and nothing else. An earlier version of this file offered
 * four -- adding `native-mmtk` and `host-jvm` -- and neither exists:
 *
 *   - **MMTk** is not implemented. `compiler/memory-lowering/src/lib.rs` says so
 *     in its own header: "experimental, gated behind RFC §3.7. Not in this crate
 *     yet." A builder taking a `plan`, a `minHeap` and a `maxHeap` for it was
 *     four parameters of a collector that does not exist.
 *   - **`host-jvm`** was not a provider either. The JVM lane emits no retains and
 *     no releases at all -- the platform collector owns everything -- and it
 *     reaches that by compiling under `NoGc`, which already means "no retains,
 *     no releases, no barriers". There was never a third thing to select.
 *
 * So a JVM target takes **no memory option at all**, because there is no choice
 * to make, and `app.android` does not accept one.
 */

/** The providers the compiler implements. */
export type MemoryProviderName = "native-rc-cycle" | "native-nogc";

export interface MemoryProvider {
  readonly provider: MemoryProviderName;
}

export interface RcCycleOptions {
  /** How the cycle collector runs. Deferred collection reads as a leak in a
   *  program too short to reach the threshold. */
  readonly cycleCollection?: "deferred" | "incremental";
}

export interface RcCycleProvider extends MemoryProvider, RcCycleOptions {
  readonly provider: "native-rc-cycle";
}

export interface NoGcProvider extends MemoryProvider {
  readonly provider: "native-nogc";
}

export const memory = {
  /** The shipping provider for native targets. */
  rcCycle: (options: RcCycleOptions = {}): RcCycleProvider => ({
    provider: "native-rc-cycle",
    ...options,
  }),
  /**
   * Allocate and never free. For bring-up, allocation testing and
   * bounded-lifetime tools -- "never a silent default for an application",
   * which is `hir::Provider`'s own wording.
   */
  noGc: (): NoGcProvider => ({ provider: "native-nogc" }),
} as const;
