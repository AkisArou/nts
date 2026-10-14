// An array of bigints: built from a literal, read, written, iterated, held in
// a field and passed along.
//
// The JVM declined every one ("a return type with no representation: an
// array of a bigint") wherever arrays grow, while C agreed: its array wrapper
// was chosen by element and had no arm for a bigint, which is a reference
// there like a string.

function build(n: bigint): bigint[] {
  return [n, n * 3n, 2n ** 70n];
}

function sum(xs: bigint[]): bigint {
  let total = 0n;
  for (const x of xs) total += x;
  return total;
}

class Ledger {
  entries: bigint[] = [1n, -2n, 3n];
  total(): bigint {
    return sum(this.entries);
  }
}

/** A literal returned, indexed and written. */
export function readsAndWrites(n: number): string {
  const xs = build(BigInt(n & 7));
  xs[1] = xs[1] + 1n;
  return String(xs[0]) + " " + String(xs[1]) + " " + String(xs.length);
}

/** Iterated with `for...of`, through a parameter. */
export function iterates(n: number): string {
  return String(sum(build(BigInt(n & 7))));
}

/** Held in a field and replaced element by element. */
export function heldInAField(n: number): string {
  const ledger = new Ledger();
  ledger.entries[n & 1] = BigInt(n & 7) * 10n;
  return String(ledger.total());
}

/** An element read back as an erased value. */
export function erased(n: number): string {
  const first: unknown = build(BigInt(n & 7))[0];
  return typeof first + " " + String(first === BigInt(n & 7));
}
