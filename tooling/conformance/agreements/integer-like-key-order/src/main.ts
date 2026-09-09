// `Object.keys` does not promote integer-like keys.
//
//     { b: 1, 2: 2, a: 3, 1: 4 }
//     compiled   b,2,a,1     -- pure insertion order
//     node       1,2,b,a     -- array-index keys first, ascending, then the rest
//                               in insertion order
//
//     { b: 1, a: 2, c: 3 }
//     compiled   b,a,c
//     node       b,a,c       -- agrees
//
// So insertion order is implemented and correct, and the **integer-key
// promotion** on top of it is not. That is a specified rule, not an
// implementation detail: an own property whose key is an array index is
// enumerated before every string key, in ascending numeric order.
//
// # Where it will be met
//
// `http`'s status table is `{ 100: "Continue", 101: "Switching Protocols", … }`
// -- every key integer-like, so any enumeration of it is in the wrong order
// unless the insertion happens to be ascending. `querystring.parse` results and
// header objects are the same shape whenever a key is numeric.
//
// It is a quiet defect: nothing throws, nothing crashes, and a test only fails
// if it compares an enumeration. That is the argument for asking the question
// at all rather than waiting for a test to ask it.

/** Node: 1. Integer-like keys first, ascending. */
export function integerKeysPromoted(): number {
  const o: Record<string, number> = { b: 1, 2: 2, a: 3, 1: 4 };
  const keys = Object.keys(o);
  return keys[0] === "1" && keys[1] === "2" ? 1 : 0;
}

/** Control: string keys alone keep insertion order, and this agrees. */
export function stringKeysKeepInsertionOrder(): number {
  const o: Record<string, number> = { b: 1, a: 2, c: 3 };
  const keys = Object.keys(o);
  return keys[0] === "b" && keys[1] === "a" && keys[2] === "c" ? 1 : 0;
}

/** Control: the count is right either way, so it is the order and not the set. */
export function keyCount(): number {
  const o: Record<string, number> = { b: 1, 2: 2, a: 3, 1: 4 };
  return Object.keys(o).length;
}
