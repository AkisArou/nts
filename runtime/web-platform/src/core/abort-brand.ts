/** Internal nominal identity shared without introducing an EventTarget/AbortSignal import cycle. */
export const abortSignalBrand: unique symbol = Symbol("NTS AbortSignal");

/** Internal operations required by cancellation-aware Web APIs. */
export interface AbortSignalOperations {
  readonly [abortSignalBrand]: true;
  readonly aborted: boolean;
  subscribe(callback: () => void): () => void;
}
