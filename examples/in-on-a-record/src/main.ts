// `"a" in o` where `o` is a `Record<string, V>`.
//
// `lower_in` asks which declared members a type has, and a table declares none
// — so the set came out empty and the whole expression folded to `false`. The
// emitted C was `v7 = false` with no use of the map after the `nts_map_set`. It
// did not lower to a lookup that missed; it did not lower to a lookup.
//
// The absent case agreed, which is why nothing caught it: `false` is the right
// answer there. Every case below therefore pairs a present key with an absent
// one, and the three neighbouring questions — `Object.hasOwn`, an index read,
// and the key count — were all already correct, so they are the controls that
// say the object is right and only the operator was not.
//
// A class instance answers `in` correctly and always did, which is what said
// this was one receiver type rather than the operator.

class Holder {
  present: number;
  constructor(n: number) {
    this.present = n;
  }
}

function table(n: number): Record<string, number> {
  const o: Record<string, number> = {};
  o["a"] = n;
  o["b"] = n + 1;
  return o;
}

/** Under test: a key that is there. */
export function presentKey(n: number): number {
  return "a" in table(n) ? n : -1;
}

/** The pair for it: a key that is not. */
export function absentKey(n: number): number {
  return "zz" in table(n) ? -1 : n;
}

/** Both at once, so a constant `true` fails as loudly as a constant `false`. */
export function bothWays(n: number): number {
  const o = table(n);
  return ("a" in o ? 100 : 0) + ("b" in o ? 10 : 0) + ("zz" in o ? 1 : 0);
}

/** Control: the read that was always right. */
export function readsBack(n: number): number {
  return table(n)["a"] ?? -1;
}

/** Control: `Object.keys`, which counted correctly all along. */
export function keyCount(n: number): number {
  return Object.keys(table(n)).length + (n % 2);
}

/** Control: a class instance, whose `in` was never wrong. */
export function onAClass(n: number): number {
  const h = new Holder(n);
  return ("present" in h ? 10 : 0) + h.present;
}
