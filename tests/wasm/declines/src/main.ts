// A shape outside the Wasm boundary: `emit-wasm` declines this export by name
// and writes the module without it, as `emit-c` leaves out a name it cannot
// publish.
export function unsupportedBigInt(n: bigint): bigint { return n + 1n; }
