declare global {
  var Math: Math;
  function isNaN(n: number): boolean;
  interface Number { readonly tag?: undefined; }
  interface ArrayBuffer { readonly tag?: undefined; }
}

export function mergedFloor(n: number): number {
  return Math.floor(n);
}

export function mergedIsNaN(n: number): boolean {
  return isNaN(n);
}

export function augmentedConstant(n: number): number {
  return n + Number.EPSILON;
}

export function augmentedView(n: number): boolean {
  return ArrayBuffer.isView(new Uint8Array([n]));
}
