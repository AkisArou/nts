// All five search methods with their position omitted. The changing input
// selects text and needle each round, so the calls are not loop invariant.
export function work(seed: number): number {
  let state = seed | 0;
  let total = 0;
  for (let i = 0; i < 1000; ++i) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const text = ((state >>> 16) & 1) === 0 ? "abracadabra" : "barbarian arena";
    const needle = ((state >>> 17) & 1) === 0 ? "a" : "ra";
    total = (total + text.indexOf(needle) + text.lastIndexOf(needle) * 2
      + (text.includes(needle) ? 4 : 0) + (text.startsWith(needle) ? 8 : 0)
      + (text.endsWith(needle) ? 16 : 0)) | 0;
  }
  return total;
}
export const seed = 3;
