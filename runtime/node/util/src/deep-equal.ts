// `util.isDeepStrictEqual`, node `lib/internal/util/comparisons.js`.
//
// Also what `assert.deepStrictEqual` compares with, which is why it is its own
// file: two callers, one algorithm.
//
// The rules that make it more than a recursive `===`:
//
//   - primitives compare with `Object.is`, so `NaN` equals `NaN` and `0` does
//     not equal `-0`;
//   - prototypes must match, so a class instance never equals a plain object
//     with the same fields;
//   - own *symbol* keys count as well as string ones;
//   - `Map` and `Set` compare without regard to order, which needs a matching
//     rather than a walk;
//   - a cycle on both sides is equal rather than infinite.

import {
  isAnyArrayBuffer, isArrayBufferView, isBoxedPrimitive, isDate, isMap,
  isNativeError, isRegExp, isSet,
} from "./types.ts";

/** Pairs already being compared, so a cycle terminates. */
type Memo = Map<object, Set<object>>;

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, new Map());
}

function equal(a: unknown, b: unknown, memo: Memo): boolean {
  // `Object.is`, not `===`: `NaN` is equal to itself here and `-0` is not
  // equal to `0`, which is the whole difference between deep-strict and deep.
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    return false;
  }

  // A cycle: if this pair is already on the stack, the structures agree so far
  // and anything below is what we are already deciding.
  const seen = memo.get(a);
  if (seen?.has(b)) {
    return true;
  }
  if (seen === undefined) {
    memo.set(a, new Set([b]));
  } else {
    seen.add(b);
  }

  const result = compareByKind(a, b, memo);
  memo.get(a)?.delete(b);
  return result;
}

function compareByKind(a: object, b: object, memo: Memo): boolean {
  if (isDate(a)) {
    return isDate(b) && Object.is(a.getTime(), (b as Date).getTime());
  }
  if (isRegExp(a)) {
    const other = b as RegExp;
    return isRegExp(b) && a.source === other.source && a.flags === other.flags;
  }
  if (isNativeError(a) || a instanceof Error) {
    const other = b as Error;
    // Node compares the message and the name, then the own properties below.
    if (a.message !== other.message || a.name !== other.name) {
      return false;
    }
  }
  if (isArrayBufferView(a)) {
    if (!isArrayBufferView(b) || a.byteLength !== b.byteLength) {
      return false;
    }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  }
  if (isAnyArrayBuffer(a)) {
    const x = new Uint8Array(a as ArrayBuffer);
    const y = new Uint8Array(b as ArrayBuffer);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  }
  if (isBoxedPrimitive(a)) {
    // Compare what they wrap, then fall through to their own properties.
    // `valueOf` is brand-checked: `String.prototype.valueOf` throws on anything
    // that is not a boxed string, and a comparison must answer `false` rather
    // than raise.
    if (!isBoxedPrimitive(b)) {
      return false;
    }
    let wrappedA: unknown;
    let wrappedB: unknown;
    try {
      wrappedA = (a as { valueOf(): unknown }).valueOf();
      wrappedB = (b as { valueOf(): unknown }).valueOf();
    } catch {
      return false;
    }
    if (!Object.is(wrappedA, wrappedB)) {
      return false;
    }
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
  }
  if (isMap(a)) {
    if (!isMap(b) || a.size !== (b as Map<unknown, unknown>).size) {
      return false;
    }
    if (!mapsEqual(a, b as Map<unknown, unknown>, memo)) {
      return false;
    }
  }
  if (isSet(a)) {
    if (!isSet(b) || a.size !== (b as Set<unknown>).size) {
      return false;
    }
    if (!setsEqual(a, b as Set<unknown>, memo)) {
      return false;
    }
  }

  return ownPropertiesEqual(a, b, memo);
}

function ownPropertiesEqual(a: object, b: object, memo: Memo): boolean {
  const aKeys = ownEnumerableKeys(a);
  const bKeys = ownEnumerableKeys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.propertyIsEnumerable.call(b, key)) {
      return false;
    }
    if (!equal((a as Record<PropertyKey, unknown>)[key], (b as Record<PropertyKey, unknown>)[key], memo)) {
      return false;
    }
  }
  return true;
}

/** Own enumerable keys, strings and symbols alike. */
function ownEnumerableKeys(value: object): PropertyKey[] {
  const keys: PropertyKey[] = Object.keys(value);
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
      keys.push(symbol);
    }
  }
  return keys;
}

/**
 * Maps are unordered, so a key that is not primitive has to be *matched*
 * against the other side rather than looked up: two structurally equal keys
 * are different objects and hash differently.
 */
function mapsEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, memo: Memo): boolean {
  const unmatched: Array<[unknown, unknown]> = [];
  for (const [key, value] of a) {
    if (key !== null && typeof key === "object") {
      unmatched.push([key, value]);
      continue;
    }
    // A primitive key can be looked up directly.
    if (!b.has(key)) {
      return false;
    }
    if (!equal(value, b.get(key), memo)) {
      return false;
    }
  }
  if (unmatched.length === 0) {
    return true;
  }

  const candidates = [...b.entries()].filter(([key]) => key !== null && typeof key === "object");
  return matchPairs(unmatched, candidates, memo);
}

function setsEqual(a: Set<unknown>, b: Set<unknown>, memo: Memo): boolean {
  const unmatched: Array<[unknown, unknown]> = [];
  for (const value of a) {
    if (value !== null && typeof value === "object") {
      unmatched.push([value, undefined]);
      continue;
    }
    if (!b.has(value)) {
      return false;
    }
  }
  if (unmatched.length === 0) {
    return true;
  }
  const candidates = [...b].filter((v) => v !== null && typeof v === "object").map(
    (v) => [v, undefined] as [unknown, unknown],
  );
  return matchPairs(unmatched, candidates, memo);
}

/**
 * A perfect matching between two lists of entries, greedily with backtracking.
 *
 * Greedy alone is wrong: the first item may match two candidates, and taking
 * the one the second item needed reports a false inequality. These lists are
 * short — they hold only the object-keyed entries — so the backtracking costs
 * nothing in practice and is the only answer that is right.
 */
function matchPairs(
  left: Array<[unknown, unknown]>,
  right: Array<[unknown, unknown]>,
  memo: Memo,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const used = new Array<boolean>(right.length).fill(false);

  const place = (i: number): boolean => {
    if (i === left.length) {
      return true;
    }
    const [key, value] = left[i]!;
    for (let j = 0; j < right.length; j++) {
      if (used[j]) continue;
      const [otherKey, otherValue] = right[j]!;
      if (!equal(key, otherKey, memo)) continue;
      if (value !== undefined || otherValue !== undefined) {
        if (!equal(value, otherValue, memo)) continue;
      }
      used[j] = true;
      if (place(i + 1)) {
        return true;
      }
      used[j] = false;
    }
    return false;
  };

  return place(0);
}
