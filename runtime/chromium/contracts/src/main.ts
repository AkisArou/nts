// Keep compiler-boundary failures separate from browser acceptance fixtures.
export interface Counter { count: number }
export function createCounter(): Counter { return { count: 0 }; }
export async function managedAwait(state: Counter): Promise<number> {
  await Promise.resolve(0);
  await Promise.resolve(0);
  state.count += 1;
  return state.count;
}
export function literalUnit(index: number): number {
  return "A\0\u00e9\u03a9\ud800Z\udc00\ud83d\ude00".charCodeAt(index);
}
