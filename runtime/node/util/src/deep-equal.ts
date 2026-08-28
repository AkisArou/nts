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
  isNativeError, isPromise, isRegExp, isSet, isWeakMap, isWeakSet,
} from "./types.ts";

/**
 * One comparison in progress: the pairs already on the stack, so a cycle
 * terminates, and whether prototypes count.
 */
interface Context {
  seen: Map<object, Set<object>>;
  /**
   * When set, two objects with the same fields are equal even if one is a
   * class instance and the other a literal. Node added it for the case where
   * the shape is what matters and the constructor is an implementation
   * detail -- comparing a `Buffer` with the `Uint8Array` it wraps, say.
   */
  skipPrototype: boolean;
}

export function isDeepStrictEqual(a: unknown, b: unknown, skipPrototype = false): boolean {
  return equal(a, b, { seen: new Map(), skipPrototype: Boolean(skipPrototype) });
}

function equal(a: unknown, b: unknown, ctx: Context): boolean {
  // `Object.is`, not `===`: `NaN` is equal to itself here and `-0` is not
  // equal to `0`, which is the whole difference between deep-strict and deep.
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (!ctx.skipPrototype && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    return false;
  }

  // A cycle: if this pair is already on the stack, the structures agree so far
  // and anything below is what we are already deciding.
  const seen = ctx.seen.get(a);
  if (seen?.has(b)) {
    return true;
  }
  if (seen === undefined) {
    ctx.seen.set(a, new Set([b]));
  } else {
    seen.add(b);
  }

  const result = compareByKind(a, b, ctx);
  ctx.seen.get(a)?.delete(b);
  return result;
}

function compareByKind(a: object, b: object, ctx: Context): boolean {
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
    // The elements are done; anything else hung on the view still counts.
    // Indices are skipped because they *are* the elements -- a typed array
    // cannot have an own index property that is not one.
    return ownPropertiesEqual(a, b, ctx, true);
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
    if (!mapsEqual(a, b as Map<unknown, unknown>, ctx)) {
      return false;
    }
  }
  if (isSet(a)) {
    if (!isSet(b) || a.size !== (b as Set<unknown>).size) {
      return false;
    }
    if (!setsEqual(a, b as Set<unknown>, ctx)) {
      return false;
    }
  }

  return ownPropertiesEqual(a, b, ctx);
}

function ownPropertiesEqual(a: object, b: object, ctx: Context, skipIndices = false): boolean {
  const aKeys = ownEnumerableKeys(a, skipIndices);
  const bKeys = ownEnumerableKeys(b, skipIndices);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.propertyIsEnumerable.call(b, key)) {
      return false;
    }
    if (!equal((a as Record<PropertyKey, unknown>)[key], (b as Record<PropertyKey, unknown>)[key], ctx)) {
      return false;
    }
  }
  return true;
}

/** Own enumerable keys, strings and symbols alike. */
function ownEnumerableKeys(value: object, skipIndices = false): PropertyKey[] {
  const keys: PropertyKey[] = skipIndices
    ? Object.keys(value).filter((k) => !/^(?:0|[1-9][0-9]*)$/.test(k))
    : Object.keys(value);
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
function mapsEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, ctx: Context): boolean {
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
    if (!equal(value, b.get(key), ctx)) {
      return false;
    }
  }
  if (unmatched.length === 0) {
    return true;
  }

  const candidates = [...b.entries()].filter(([key]) => key !== null && typeof key === "object");
  return matchPairs(unmatched, candidates, ctx);
}

function setsEqual(a: Set<unknown>, b: Set<unknown>, ctx: Context): boolean {
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
  return matchPairs(unmatched, candidates, ctx);
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
  ctx: Context,
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
      if (!equal(key, otherKey, ctx)) continue;
      if (value !== undefined || otherValue !== undefined) {
        if (!equal(value, otherValue, ctx)) continue;
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

// --------------------------------------------------- the two looser relations
//
// `assert.deepEqual` and `assert.partialDeepStrictEqual` are the other two
// comparisons node offers, and they live here for the reason the strict one
// does: one file, so that a rule discovered in one is not missed by the
// others.

/**
 * Loose deep equality: the same walk as the strict one, with `==` at the
 * leaves and no prototype check. Kept because a great deal of code predates
 * `deepStrictEqual`, and deprecated in node's documentation for the reason
 * that `'1' == 1`.
 */
function looseEqual(a: unknown, b: unknown, seen: Map<object, Set<object>>): boolean {
  if (a === b) {
    return true;
  }

  // `==` applies only when *both* sides are primitives. Comparing a primitive
  // against an object with it would make `'a'` loosely deep-equal to `['a']`,
  // because `['a'] == 'a'` coerces through `toString` -- and node says those
  // are not deep-equal, whatever `==` says about them.
  const aPrimitive = a === null || typeof a !== "object";
  const bPrimitive = b === null || typeof b !== "object";
  if (aPrimitive || bPrimitive) {
    if (aPrimitive && bPrimitive) {
      // eslint-disable-next-line eqeqeq
      return a == b ||
        (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
    }
    return false;
  }
  const known = seen.get(a);
  if (known?.has(b)) {
    return true;
  }
  seen.set(a, (known ?? new Set()).add(b));

  // A `Date` with no own keys and `{}` both have zero enumerable properties,
  // so the key walk below would call them equal. Every kind whose *identity*
  // lives outside its properties has to be checked for symmetry first.
  // Guards, not answers: two regexps with the same source can still differ in
  // their own properties, and the key walk below is what sees that. Returning
  // early here made `/test/` equal to a `MyRegExp` carrying an extra field.
  if (isDate(a) || isDate(b)) {
    if (!isDate(a) || !isDate(b) || (a as Date).getTime() !== (b as Date).getTime()) {
      return false;
    }
  }
  if (isRegExp(a) || isRegExp(b)) {
    if (
      !isRegExp(a) || !isRegExp(b) ||
      (a as RegExp).source !== (b as RegExp).source ||
      (a as RegExp).flags !== (b as RegExp).flags
    ) {
      return false;
    }
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || (a as Map<unknown, unknown>).size !== (b as Map<unknown, unknown>).size) {
      return false;
    }
  }
  if (isSet(a) || isSet(b)) {
    if (!isSet(a) || !isSet(b) || (a as Set<unknown>).size !== (b as Set<unknown>).size) {
      return false;
    }
  }
  if (isArrayBufferView(a) || isArrayBufferView(b)) {
    if (!isArrayBufferView(a) || !isArrayBufferView(b)) {
      return false;
    }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (isMap(a)) {
    for (const [key, value] of a as Map<unknown, unknown>) {
      if (!(b as Map<unknown, unknown>).has(key)) {
        return false;
      }
      if (!looseEqual(value, (b as Map<unknown, unknown>).get(key), seen)) {
        return false;
      }
    }
  }
  if (isSet(a)) {
    for (const value of a as Set<unknown>) {
      if (!(b as Set<unknown>).has(value)) {
        return false;
      }
    }
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!looseEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen)) {
      return false;
    }
  }
  return true;
}

/**
 * `assert.deepEqual`'s relation: the same walk with `==` at the leaves and no
 * prototype check.
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  return looseEqual(a, b, new Map());
}

/**
 * `assert.partialDeepStrictEqual`'s walk.
 *
 * The question is not "are these the same" but "does `actual` contain
 * `expected`", which changes the rule for every container:
 *
 *   arrays        `expected` must appear as a subsequence, not at the same
 *                 indices -- a caller checking that a log contains two lines
 *                 does not care what came between them
 *   sets, maps    every entry of `expected` must be matched by one of
 *                 `actual`'s, and `actual` may have more
 *   objects       every own key of `expected` must match; keys `actual` has
 *                 beyond them are not looked at
 *
 * What does not change: the *kinds* must still agree. A `Map` does not contain
 * a plain object with the same entries, and two `WeakMap`s are never equal
 * because there is no way to look inside one.
 */
function partialEqual(actual: unknown, expected: unknown, seen: Cycles): boolean {
  if (Object.is(actual, expected)) {
    return true;
  }
  if (typeof expected !== "object" || expected === null ||
      typeof actual !== "object" || actual === null) {
    return false;
  }
  // A tag is part of what a value claims to be, and two values that disagree
  // about it are not the same kind whatever their contents.
  if (tagOf(actual) !== tagOf(expected)) {
    return false;
  }
  // Nothing enumerable to look at, and identity was ruled out above.
  if (isWeakMap(expected) || isWeakSet(expected) || isPromise(expected)) {
    return false;
  }
  // A pair already under consideration: whatever is below it is what this
  // call is deciding, so treating it as matching is what terminates.
  const known = seen.get(actual);
  if (known?.has(expected)) {
    return true;
  }
  seen.set(actual, (known ?? new Set()).add(expected));

  if (isURL(expected)) {
    return isURL(actual) &&
      (actual as { href: string }).href === (expected as { href: string }).href;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) {
      return false;
    }
    if (!isSubsequence(presentValues(actual), presentValues(expected), seen)) {
      return false;
    }
    return partialOwnKeys(actual, expected, seen, indexKey);
  }

  if (isSet(expected)) {
    if (!isSet(actual) || actual.size < expected.size) {
      return false;
    }
    return everyMatched([...expected], [...actual], (a, b) => partialEqual(b, a, seen));
  }

  if (isMap(expected)) {
    if (!isMap(actual) || actual.size < expected.size) {
      return false;
    }
    // Matched as pairs rather than by lookup: an object key in `expected` is a
    // different object from the equal one in `actual`, so `get` would miss it.
    return everyMatched(
      [...expected],
      [...actual],
      ([k1, v1], [k2, v2]) => partialEqual(k2, k1, seen) && partialEqual(v2, v1, seen),
    );
  }

  if (isDate(expected)) {
    return isDate(actual) && Object.is(actual.getTime(), expected.getTime());
  }

  if (isRegExp(expected)) {
    return isRegExp(actual) &&
      actual.source === expected.source &&
      actual.flags === expected.flags;
  }

  if (isArrayBufferView(expected)) {
    if (!isArrayBufferView(actual)) {
      return false;
    }
    const wanted = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
    const found = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    return isSubsequence([...found], [...wanted], seen) && partialOwnKeys(actual, expected, seen, indexKey);
  }

  if (isAnyArrayBuffer(expected)) {
    if (!isAnyArrayBuffer(actual)) {
      return false;
    }
    return isSubsequence(
      [...new Uint8Array(actual as ArrayBuffer)],
      [...new Uint8Array(expected as ArrayBuffer)],
      seen,
    );
  }

  if (isBoxedPrimitive(expected)) {
    if (!isBoxedPrimitive(actual)) {
      return false;
    }
    try {
      if (!Object.is(
        (actual as { valueOf(): unknown }).valueOf(),
        (expected as { valueOf(): unknown }).valueOf(),
      )) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (expected instanceof Error) {
    // The stack is left out: two errors raised from different lines are still
    // the same error as far as a comparison is concerned.
    if (!(actual instanceof Error)) {
      return false;
    }
    for (const key of ["message", "name", "cause", "errors"] as const) {
      const want = (expected as unknown as Record<string, unknown>)[key];
      // An expectation of `undefined` asks nothing, and neither does the empty
      // message a bare `new Error()` carries -- both are what an error has
      // when nobody set them, so requiring them would make `new Error()` match
      // nothing rather than anything.
      if (want === undefined || (key === "message" && want === "")) {
        continue;
      }
      if (!partialEqual((actual as unknown as Record<string, unknown>)[key], want, seen)) {
        return false;
      }
    }
    // Set explicitly, even to `undefined`, it is part of the expectation.
    if (Object.hasOwn(expected, "cause") && !Object.hasOwn(actual, "cause")) {
      return false;
    }
  }

  return partialOwnKeys(actual, expected, seen);
}

/** `Object.prototype.toString`'s answer, which a `Symbol.toStringTag` changes. */
function tagOf(value: object): string {
  return Object.prototype.toString.call(value);
}

const indexKey = /^(?:0|[1-9][0-9]*)$/;

/**
 * The values an array actually holds, in index order, holes left out.
 *
 * A hole is not a value, and a subsequence match should not have to step over
 * a hundred million of them -- `[1, 2, , ... , 3]` with a length in the
 * millions is a real shape and `Object.keys` gives only the indices that are
 * there.
 */
function presentValues(array: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const key of Object.keys(array)) {
    if (indexKey.test(key)) {
      out.push((array as unknown as Record<string, unknown>)[key]);
    }
  }
  return out;
}

/** Pairs already on the stack, so a structure that points at itself terminates. */
type Cycles = Map<object, Set<object>>;

/**
 * A `URL` compares by its serialisation; its internals are derived from it.
 *
 * By tag rather than by `instanceof`, so that a `URL` from another realm is
 * still one -- and so that this file does not have to name a global the
 * language does not define.
 */
function isURL(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object URL]";
}

/**
 * Every own enumerable key of `expected` -- strings and symbols -- present on
 * `actual` and partially equal. `skip` drops keys compared some other way.
 */
function partialOwnKeys(actual: object, expected: object, seen: Cycles, skip?: RegExp): boolean {
  for (const key of Reflect.ownKeys(expected)) {
    if (!Object.prototype.propertyIsEnumerable.call(expected, key)) {
      continue;
    }
    if (skip !== undefined && typeof key === "string" && skip.test(key)) {
      continue;
    }
    if (!Object.prototype.propertyIsEnumerable.call(actual, key)) {
      return false;
    }
    if (!partialEqual(
      (actual as Record<PropertyKey, unknown>)[key],
      (expected as Record<PropertyKey, unknown>)[key],
      seen,
    )) {
      return false;
    }
  }
  return true;
}

/**
 * Is `wanted` a subsequence of `found`?
 *
 * Greedy from the left, which is correct here because the elements are matched
 * by equality rather than by a pattern: if the first unmatched element of
 * `wanted` occurs at all, taking its earliest occurrence never rules out a
 * later match.
 */
function isSubsequence<T>(found: readonly T[], wanted: readonly T[], seen: Cycles): boolean {
  let at = 0;
  for (const item of wanted) {
    while (at < found.length && !Object.is(found[at], item) && !partialEqual(found[at], item, seen)) {
      at++;
    }
    if (at >= found.length) {
      return false;
    }
    at++;
  }
  return true;
}

/**
 * Each of `wanted` matched by a distinct member of `found`.
 *
 * A member already used is not offered again, so two equal entries in
 * `expected` need two in `actual`. The search is quadratic and the collections
 * are small; matching by lookup instead would miss structurally equal keys
 * that are different objects.
 */
function everyMatched<T>(
  wanted: readonly T[],
  found: readonly T[],
  matches: (a: T, b: T) => boolean,
): boolean {
  const used = new Array<boolean>(found.length).fill(false);
  for (const item of wanted) {
    let matched = false;
    for (let i = 0; i < found.length; i++) {
      if (!used[i] && matches(item, found[i]!)) {
        used[i] = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

/**
 * `assert.partialDeepStrictEqual`'s relation: every key in `expected` must
 * match, and keys the actual value has beyond them are ignored.
 */
export function isPartialStrictEqual(actual: unknown, expected: unknown): boolean {
  return partialEqual(actual, expected, new Map());
}
