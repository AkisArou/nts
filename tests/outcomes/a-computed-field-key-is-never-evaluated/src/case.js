// A class field whose name the program computes, `[key()] = 1`, has its key
// evaluated once, when the class is defined, in source order with the other
// keys -- static or not. Here the key expression is never evaluated: the
// field is dropped with no diagnostic, so its side effects never happen.
// node: 1 for each arm; nts: 0.
//
// Computed *method* keys refuse by name ("a member whose name the program
// computes"); a computed field key is the same construct with no refusal.
//
// The control is `constantKey`: the same class with the key written as a
// string literal, whose initializer's call is counted and agrees.
//
// Typed TypeScript cannot spell a computed field key that is not a literal
// (TS1166), so the case is JS. Found while probing the order of
// `static ["prototype"]` against computed keys (2026-10-20).

let logged = 0;

/** @param {string} key @returns {string} */
function log(key) {
  logged = logged + 1;
  return key;
}

/** @param {number} n @returns {number} */
export function staticField(n) {
  logged = 0;
  class K {
    static [log("k")] = 1;
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}

/** @param {number} n @returns {number} */
export function instanceField(n) {
  logged = 0;
  class K {
    [log("k")] = 1;
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}

/** @param {number} n @returns {number} */
export function constantKey(n) {
  logged = 0;
  class K {
    static ["k"] = log("v");
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}
