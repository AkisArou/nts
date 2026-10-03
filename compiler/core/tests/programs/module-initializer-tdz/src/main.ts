// Its value folds to 3, but evaluating the initializer throws before then.
// @ts-expect-error -- deliberately read before initialization
const early = later + 1;
const later = 2;
export function read(n: number): number { return early + later + n; }
export function identify(error: Error): string { return error.name; }
