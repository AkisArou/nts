/** An environment origin measured in both clock domains by its provider. */
export interface PerformanceTimeOrigin {
  /** Epoch-relative milliseconds for the selected environment time origin. */
  readonly epochMilliseconds: number;
  /** The same instant in this runtime's monotonicMilliseconds() clock domain. */
  readonly monotonicMilliseconds: number;
}

/** Native serialization failures cross the binding as values, never throws. */
export type PerformanceDetailCloneResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

export interface PerformanceDetailCloner {
  /** StructuredSerialize followed by StructuredDeserialize in this environment. */
  clone(value: object): PerformanceDetailCloneResult;
}

/**
 * Optional capabilities beyond PlatformPrimitives' relative monotonic clock.
 *
 * The provider must select the environment origin and supply both measurements
 * of that same instant. Sampling wallTimeMilliseconds() - monotonicMilliseconds()
 * is not an equivalent correlation. Clock coarsening and cross-context agreement
 * are the provider's responsibility. No epoch or origin is invented when absent.
 */
export interface PerformanceCapabilities {
  readonly timeOrigin?: PerformanceTimeOrigin;
  readonly detailCloner?: PerformanceDetailCloner;
}
