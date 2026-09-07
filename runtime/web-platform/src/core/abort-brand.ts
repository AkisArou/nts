/** Internal nominal identity shared without introducing an EventTarget/AbortSignal import cycle. */
export const abortSignalBrand: unique symbol = Symbol("NTS AbortSignal");

/**
 * Keys for the two members other modules need and the standard does not define.
 *
 * Here rather than in `abort.ts` for the same reason the brand is: this module exists so
 * cancellation-aware code can name these without an import cycle. Symbols so they leave the
 * interface prototype, and deliberately not re-exported from the public barrel.
 */
export const abortSignalSubscribe: unique symbol = Symbol("AbortSignal subscribe");
export const abortSignalTrigger: unique symbol = Symbol("AbortSignal trigger");

/** Internal operations required by cancellation-aware Web APIs. */
export interface AbortSignalOperations {
  readonly [abortSignalBrand]: true;
  readonly aborted: boolean;
  [abortSignalSubscribe](callback: () => void): () => void;
}
