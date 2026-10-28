/** Internal symbol marker for cancellation-aware modules; not a Web IDL brand check. */
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

type AbortSignalBrandCheck = (value: unknown) => value is AbortSignalOperations;

let checkAbortSignalBrand: AbortSignalBrandCheck | undefined;
let readAbortSignalState!: (signal: AbortSignalOperations) => boolean;
let subscribeAbortSignalState!: (
  signal: AbortSignalOperations,
  callback: () => void,
) => () => void;

/**
 * Installed once by AbortSignal's static initializer, with access to its private
 * state. This module has no runtime imports, keeping EventTarget independent of
 * its AbortSignal subclass. Neither this installer nor the operations are public
 * Web APIs or re-exported from the package's barrels.
 */
export function installAbortSignalOperations(
  brand: AbortSignalBrandCheck,
  aborted: (signal: AbortSignalOperations) => boolean,
  subscribe: (signal: AbortSignalOperations, callback: () => void) => () => void,
): void {
  if (checkAbortSignalBrand !== undefined) {
    throw new TypeError("AbortSignal operations are already installed");
  }
  readAbortSignalState = aborted;
  subscribeAbortSignalState = subscribe;
  checkAbortSignalBrand = brand;
}

/** Web IDL interface conversion never consults script-visible properties. */
export function isAbortSignal(value: unknown): value is AbortSignalOperations {
  return checkAbortSignalBrand !== undefined && checkAbortSignalBrand(value);
}

/** Read the internal abort state of a signal that has passed interface conversion. */
export function isAbortSignalAborted(signal: AbortSignalOperations): boolean {
  return readAbortSignalState(signal);
}

/** Add an abort step without consulting an overridable method on the signal. */
export function subscribeAbortSignal(
  signal: AbortSignalOperations,
  callback: () => void,
): () => void {
  return subscribeAbortSignalState(signal, callback);
}
