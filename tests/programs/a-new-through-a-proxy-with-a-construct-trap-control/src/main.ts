// Control for refusals/a-new-through-a-proxy-with-a-construct-trap: the same
// `new` through a constant alias of `Array` rather than a proxy, which
// constructs an `Array`.
const Trapped = Array;
export function probe(n: number): number {
  const made = new Trapped((n & 3) + 1);
  return made.length * 10 + (made[0] === 7 ? 1 : 0);
}
