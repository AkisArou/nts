/**
 * Memory providers (RFC §6.4, §9).
 *
 * The provider is a build dimension, not a property of the runtime: MIR carries
 * abstract `managed.*` operations and the selected provider lowers them
 * (RFC §7.2). Choosing one here is what decides whether a field store becomes a
 * retain/release pair, a card-marking barrier, or an ordinary JVM `putfield`.
 */

/** Names of the providers the compiler can lower to. */
export type MemoryProviderName =
  | "native-rc-cycle"
  | "native-mmtk"
  | "native-nogc"
  | "host-jvm";

export interface MemoryProvider {
  readonly provider: MemoryProviderName;
}

export interface RcCycleOptions {
  /** How cycle collection is scheduled. */
  readonly cycleCollection?: "incremental" | "stop-the-world";
}

export interface RcCycleProvider extends MemoryProvider, RcCycleOptions {
  readonly provider: "native-rc-cycle";
}

/**
 * MMTk collection plans (RFC §3.6).
 *
 * Ordered as the integration sequence intends them to be adopted: prove
 * allocation and roots under NoGC, then scanning under MarkSweep, and only then
 * move objects deliberately to expose illegal raw pointers.
 */
export type MmtkPlan =
  | "NoGC"
  | "MarkSweep"
  | "Immix"
  | "SemiSpace"
  | "GenCopy"
  | "GenImmix"
  | "StickyImmix";

export interface MmtkOptions {
  /**
   * Required. MMTk is an experimental provider (RFC §3.4) and may not become a
   * default until the gates in RFC §3.7 pass, so opting in is explicit.
   */
  readonly experimental: true;
  readonly plan: MmtkPlan;
  readonly minHeap?: string;
  readonly maxHeap?: string;
}

export interface MmtkProvider extends MemoryProvider, MmtkOptions {
  readonly provider: "native-mmtk";
}

export interface NoGcProvider extends MemoryProvider {
  readonly provider: "native-nogc";
}

export interface HostGcProvider extends MemoryProvider {
  readonly provider: "host-jvm";
}

/** Reference counting plus cycle collection — the first shipping provider. */
export const rcCycle = (options: RcCycleOptions = {}): RcCycleProvider => ({
  provider: "native-rc-cycle",
  ...options,
});

/** MMTk, experimental. Restricted to compatible product/platform pairs. */
export const mmtk = (options: MmtkOptions): MmtkProvider => ({
  provider: "native-mmtk",
  ...options,
});

/**
 * No collection at all.
 *
 * For compiler bring-up, allocation tests, and bounded-lifetime tools only.
 * RFC §9.1: never selected silently for a general application, which is why
 * there is no default that reaches it.
 */
export const noGc = (): NoGcProvider => ({ provider: "native-nogc" });

/** The platform's own collector. Used for JVM and Android products (RFC §13). */
export const hostGC = (): HostGcProvider => ({ provider: "host-jvm" });

export const memory = { rcCycle, mmtk, noGc, hostGC } as const;
