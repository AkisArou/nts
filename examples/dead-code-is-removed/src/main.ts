// A fixture for asserting that dead code elimination **did something**.
//
// Every other test around the optimiser asks whether the program is still
// correct, and a program that computes everything and throws it away is a
// correct program. So a pass that stopped running entirely would be invisible to
// all of them — which is exactly how a cache in this repository died for six
// hours with a passing test beside it.
//
// The constants are distinctive so the assertion can name them rather than count
// operations: `77777` and `88888` appear nowhere else in the corpus, and neither
// should survive into the prepared program.

/** `unused` is never read, so the multiplication must not reach the backend. */
export function deadMultiply(n: number): number {
  const unused = n * 77777;
  return n + 1;
}

/** Dead through two levels: `also` is only read by `unused`, which is dead. */
export function deadChain(n: number): number {
  const also = n * 88888;
  const unused = also + also;
  return n + 2;
}

/** The live half, so the fixture cannot pass by the program being empty. */
export function live(n: number): number {
  return n * 3 + 4;
}
