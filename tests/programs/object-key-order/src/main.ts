// `Object.keys` order on a `Record`.
//
// JavaScript's own-property order is not insertion order: every key that is an
// **array index** comes first, ascending, and the rest follow in insertion
// order. `nts_map_keys_str` walked once and wrote each key as it came, and its
// comment said "the array of keys in insertion order" — which described the
// function accurately and left out that the language's order is something else.
//
// `http`'s status table is `{ 100: "Continue", 101: "Switching Protocols", … }`,
// every key an index, so any enumeration of it was wrong unless the insertion
// happened to be ascending.
//
// The cases return a *digest* of the order rather than a string, because the
// harness compares scalars: each key contributes its position times a weight, so
// two different orders cannot collide.
//
// String-only and index-only tables are the controls. Insertion order was
// already right for the first, and the second is where the promotion has to hold
// its own ordering — a fixture with only mixed keys could pass on a rule that
// sorted everything.

function digest(keys: string[]): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    let unit = 0;
    for (let j = 0; j < keys[i]!.length; j++) unit = unit * 31 + keys[i]!.charCodeAt(j);
    total = total * 7 + (unit % 1000) * (i + 1);
  }
  return total % 1000000;
}

/** Under test: indices interleaved with strings, inserted out of order. */
export function mixedKeys(n: number): number {
  const o: Record<string, number> = {};
  o["b"] = n;
  o["2"] = n;
  o["a"] = n;
  o["1"] = n;
  return digest(Object.keys(o));
}

/** Indices only, inserted descending — the promotion must sort them. */
export function indexKeysOnly(n: number): number {
  const o: Record<string, number> = {};
  o["10"] = n;
  o["2"] = n;
  o["0"] = n;
  return digest(Object.keys(o));
}

/** Control: strings only, which insertion order already had right. */
export function stringKeysOnly(n: number): number {
  const o: Record<string, number> = {};
  o["zeta"] = n;
  o["alpha"] = n;
  o["mid"] = n;
  return digest(Object.keys(o));
}

/** Keys that look numeric and are not indices: they stay in insertion order. */
export function nearlyIndices(n: number): number {
  const o: Record<string, number> = {};
  o["01"] = n;
  o["1.5"] = n;
  o["-1"] = n;
  o["4294967295"] = n;
  o["7"] = n;
  return digest(Object.keys(o));
}

/** The count, which was never wrong and must stay right. */
export function keyCount(n: number): number {
  const o: Record<string, number> = {};
  o["b"] = n;
  o["2"] = n;
  o["a"] = n;
  return Object.keys(o).length;
}
