// Count leading zeros of a 32-bit integer. `Math.clz32` is available on
// every host this runs on.
export const clz32: (x: number) => number = Math.clz32;
