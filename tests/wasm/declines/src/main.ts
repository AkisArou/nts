// A shape outside the supported Wasm surface: it must refuse by name before
// any output exists.
export function unsupportedBigInt(n: bigint): bigint { return n + 1n; }
