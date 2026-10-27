// run: check
// backend: llvm

// L15: an optional callback held in a field loses the enclosing handler.
// The control calls the same callback through an optional parameter instead.
interface OptionalCallback {
  run?: ((n: number) => number) | undefined;
}

function operation(n: number): number {
  if (n < 0) throw new Error("negative");
  return n + 1;
}

function callField(target: OptionalCallback, n: number): number {
  try {
    return target.run?.(n) ?? -1;
  } catch {
    return 97;
  }
}

function callParameter(run: ((n: number) => number) | undefined, n: number): number {
  try {
    return run?.(n) ?? -1;
  } catch {
    return 97;
  }
}

export function throughOptionalField(n: number): number {
  return callField({ run: operation }, n);
}

export function throughOptionalParameter(n: number): number {
  return callParameter(operation, n);
}
