// `util.isDeepStrictEqual`, node `lib/internal/util/comparisons.js`.
//
// Also what `assert.deepStrictEqual` compares with, which is why it is its own
// file: two callers, one algorithm.
//
// The supported rules that make it more than a recursive `===`:
//
//   - primitives compare with `Object.is`, so `NaN` equals `NaN` and `0` does
//     not equal `-0`;
//   - built-in values are compared by an explicit nominal kind and their
//     hidden state; ordinary objects are compared by declared string fields;
//   - `Map` and `Set` compare without regard to order, which needs a matching
//     rather than a walk;
//   - a cycle on both sides is equal rather than infinite.
//
// Prototype identity, realms, descriptors, and dynamically discovered symbol
// fields are intentionally absent. They require the §13 metaobject model that
// a flat statically typed NTS object does not carry.

import {
  isAnyArrayBuffer, isArrayBufferView, isBigInt64Array, isBigUint64Array,
  isBoxedPrimitive, isDataView, isDate, isFloat16Array,
  isFloat32Array, isFloat64Array, isInt16Array, isInt32Array, isInt8Array,
  isMap, isNativeError, isPromise, isRegExp, isSet, isUint16Array,
  isUint32Array, isUint8Array,
  isUint8ClampedArray, isWeakMap, isWeakSet,
} from "./types.ts";

/**
 * One comparison in progress: the pairs already on the stack, so a cycle
 * terminates, and which equality relation is running.
 */
interface Context {
  seen: Map<object, Set<object>>;
  /**
   * Which relation is running.
   *
   * The helpers below -- matching a `Set`'s members, matching a `Map`'s
   * entries -- are the same work for both, and were written twice before this.
   * The second copy matched object members by identity where the first matched
   * them structurally, so `assert.deepEqual` reported two sets of equal errors
   * as different. One flag is cheaper than two walks that have to be kept in
   * step by hand.
   */
  loose: boolean;
}

/**
 * The JavaScript boundary accepts `unknown`, so property values remain
 * `unknown` until the recursive comparison narrows them. This index signature
 * describes reads from an ordinary object; it does not claim a concrete field
 * type and therefore cannot smuggle `any` into the comparison.
 */
interface IndexableObject {
  readonly [key: PropertyKey]: unknown;
}

function isIndexableObject(value: unknown): value is IndexableObject {
  return value !== null && typeof value === "object";
}

/** The comparison this context is for. */
function compare(a: unknown, b: unknown, ctx: Context): boolean {
  return ctx.loose ? looseEqual(a, b, ctx) : equal(a, b, ctx);
}

function aggregateMembers(error: AggregateError): unknown {
  return error.errors;
}

/** Error state that is not exposed through enumerable own keys. */
function errorsEqual(a: Error, b: Error, ctx: Context): boolean {
  if (a.message !== b.message || a.name !== b.name) {
    return false;
  }

  const aHasCause = Object.hasOwn(a, "cause");
  const bHasCause = Object.hasOwn(b, "cause");
  if (aHasCause !== bHasCause) {
    return false;
  }
  if (aHasCause && !compare(a.cause, b.cause, ctx)) {
    return false;
  }

  const aIsAggregate = a instanceof AggregateError;
  const bIsAggregate = b instanceof AggregateError;
  if (aIsAggregate !== bIsAggregate) {
    return false;
  }
  return !aIsAggregate || !bIsAggregate ||
    compare(aggregateMembers(a), aggregateMembers(b), ctx);
}

function arrayBufferViewsShareKind(a: ArrayBufferView, b: ArrayBufferView): boolean {
  return (isDataView(a) && isDataView(b)) ||
    (isUint8Array(a) && isUint8Array(b)) ||
    (isUint8ClampedArray(a) && isUint8ClampedArray(b)) ||
    (isUint16Array(a) && isUint16Array(b)) ||
    (isUint32Array(a) && isUint32Array(b)) ||
    (isInt8Array(a) && isInt8Array(b)) ||
    (isInt16Array(a) && isInt16Array(b)) ||
    (isInt32Array(a) && isInt32Array(b)) ||
    (isFloat16Array(a) && isFloat16Array(b)) ||
    (isFloat32Array(a) && isFloat32Array(b)) ||
    (isFloat64Array(a) && isFloat64Array(b)) ||
    (isBigInt64Array(a) && isBigInt64Array(b)) ||
    (isBigUint64Array(a) && isBigUint64Array(b));
}

function isFloatArray(
  value: ArrayBufferView,
): value is Float16Array | Float32Array | Float64Array {
  return isFloat16Array(value) || isFloat32Array(value) || isFloat64Array(value);
}

function arrayBufferViewContentsEqual(
  a: ArrayBufferView,
  b: ArrayBufferView,
  loose: boolean,
): boolean {
  if (a.byteLength !== b.byteLength) return false;
  if (loose && isFloatArray(a) && isFloatArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function arrayBuffersShareKind(
  a: ArrayBuffer | SharedArrayBuffer,
  b: ArrayBuffer | SharedArrayBuffer,
): boolean {
  return (a instanceof ArrayBuffer && b instanceof ArrayBuffer) ||
    (a instanceof SharedArrayBuffer && b instanceof SharedArrayBuffer);
}

function arrayBufferContentsEqual(
  a: ArrayBuffer | SharedArrayBuffer,
  b: ArrayBuffer | SharedArrayBuffer,
): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Runtime kinds whose state does not live in enumerable object fields.
 *
 * NTS has no prototype chain to compare. These nominal checks are the static
 * replacement: if one side is a supported built-in kind, the other side must
 * be that same kind. User classes are compared by their declared fields.
 */
function supportedObjectKindsMatch(a: IndexableObject, b: IndexableObject): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b);
  }
  if (isArrayBufferView(a) || isArrayBufferView(b)) {
    return isArrayBufferView(a) && isArrayBufferView(b) &&
      arrayBufferViewsShareKind(a, b);
  }
  if (isAnyArrayBuffer(a) || isAnyArrayBuffer(b)) {
    return isAnyArrayBuffer(a) && isAnyArrayBuffer(b) &&
      arrayBuffersShareKind(a, b);
  }
  if (isDate(a) || isDate(b)) return isDate(a) && isDate(b);
  if (isRegExp(a) || isRegExp(b)) return isRegExp(a) && isRegExp(b);
  if (isMap(a) || isMap(b)) return isMap(a) && isMap(b);
  if (isSet(a) || isSet(b)) return isSet(a) && isSet(b);
  if (isWeakMap(a) || isWeakMap(b)) return isWeakMap(a) && isWeakMap(b);
  if (isWeakSet(a) || isWeakSet(b)) return isWeakSet(a) && isWeakSet(b);
  if (isPromise(a) || isPromise(b)) return isPromise(a) && isPromise(b);
  if (isBoxedPrimitive(a) || isBoxedPrimitive(b)) {
    return isBoxedPrimitive(a) && isBoxedPrimitive(b) &&
      typeof a.valueOf() === typeof b.valueOf();
  }
  if (isNativeError(a) || isNativeError(b)) {
    if (!isNativeError(a) || !isNativeError(b)) return false;
    return (a instanceof AggregateError) === (b instanceof AggregateError);
  }
  if (isURL(a) || isURL(b)) return isURL(a) && isURL(b);
  return true;
}

export function isDeepStrictEqual(a: unknown, b: unknown, _skipPrototype = false): boolean {
  // NTS objects have one static layout and no prototype pointer. Keep the
  // Node option in the public signature, but there is no runtime prototype
  // comparison for it to disable in the compiled representation.
  return equal(a, b, { seen: new Map(), loose: false });
}

function equal(a: unknown, b: unknown, ctx: Context): boolean {
  // `Object.is`, not `===`: `NaN` is equal to itself here and `-0` is not
  // equal to `0`, which is the whole difference between deep-strict and deep.
  if (Object.is(a, b)) {
    return true;
  }
  if (!isIndexableObject(a) || !isIndexableObject(b)) {
    return false;
  }
  if (!supportedObjectKindsMatch(a, b)) {
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

function compareByKind(a: IndexableObject, b: IndexableObject, ctx: Context): boolean {
  // Before every other kind, because these are the ones with nothing to
  // compare. A `WeakMap` will not say what it holds, a `Promise` has not
  // necessarily settled, and neither has own enumerable properties -- so the
  // key walk at the bottom of this function finds two empty objects and calls
  // them equal. Identity was ruled out by the caller, so the answer is no.
  //
  // This is the shape of mistake that survives a test suite: the fall-through
  // gives a well-formed answer, and it is the *right* answer for a `WeakRef`
  // (node agrees two distinct ones are deep-equal, for exactly this reason)
  // and the wrong one here. Nothing at the point of the fall-through
  // distinguishes them.
  if (
    isWeakMap(a) || isWeakSet(a) || isPromise(a) ||
    isWeakMap(b) || isWeakSet(b) || isPromise(b)
  ) {
    return false;
  }
  if (isDate(a) || isDate(b)) {
    if (!isDate(a) || !isDate(b) || !Object.is(a.getTime(), b.getTime())) {
      return false;
    }
  }
  if (isRegExp(a) || isRegExp(b)) {
    if (!isRegExp(a) || !isRegExp(b) || a.source !== b.source || a.flags !== b.flags) {
      return false;
    }
  }
  if (isURL(a) || isURL(b)) {
    if (!isURL(a) || !isURL(b) || a.href !== b.href) {
      return false;
    }
  }
  const aIsError = isNativeError(a);
  const bIsError = isNativeError(b);
  if (aIsError || bIsError) {
    if (!aIsError || !bIsError || !errorsEqual(a, b, ctx)) {
      return false;
    }
  }
  if (isArrayBufferView(a) || isArrayBufferView(b)) {
    if (!isArrayBufferView(a) || !isArrayBufferView(b) || !arrayBufferViewsShareKind(a, b)) {
      return false;
    }
    if (!arrayBufferViewContentsEqual(a, b, false)) return false;
    // The elements are done; anything else hung on the view still counts.
    // Indices are skipped because they *are* the elements -- a typed array
    // cannot have an own index property that is not one.
    return ownPropertiesEqual(a, b, ctx, true);
  }
  if (isAnyArrayBuffer(a) || isAnyArrayBuffer(b)) {
    return isAnyArrayBuffer(a) && isAnyArrayBuffer(b) &&
      arrayBuffersShareKind(a, b) && arrayBufferContentsEqual(a, b);
  }
  if (isBoxedPrimitive(a) || isBoxedPrimitive(b)) {
    // Compare what they wrap, then fall through to their own properties.
    // The nominal guards above prove that both receivers are supported boxed
    // values, so `valueOf` is typed and cannot be called on a forged receiver.
    if (!isBoxedPrimitive(b)) {
      return false;
    }
    if (!Object.is(a.valueOf(), b.valueOf())) {
      return false;
    }
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || a.size !== b.size) {
      return false;
    }
    if (!mapsEqual(a, b, ctx)) {
      return false;
    }
  }
  if (isSet(a) || isSet(b)) {
    if (!isSet(a) || !isSet(b) || a.size !== b.size) {
      return false;
    }
    if (!setsEqual(a, b, ctx)) {
      return false;
    }
  }

  return ownPropertiesEqual(a, b, ctx);
}

function ownPropertiesEqual(
  a: IndexableObject,
  b: IndexableObject,
  ctx: Context,
  skipIndices = false,
): boolean {
  const aKeys = ownEnumerableKeys(a, skipIndices);
  const bKeys = ownEnumerableKeys(b, skipIndices);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    if (!equal(a[key], b[key], ctx)) {
      return false;
    }
  }
  return true;
}

/** Own enumerable string keys from the object's static field layout. */
function ownEnumerableKeys(value: IndexableObject, skipIndices = false): string[] {
  return skipIndices
    ? Object.keys(value).filter((k) => !/^(?:0|[1-9][0-9]*)$/.test(k))
    : Object.keys(value);
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
    // Through `compare`, not `equal`: this helper serves both relations, and
    // comparing a loose walk's map values strictly is the same duplication
    // bug one level down.
    if (!compare(value, b.get(key), ctx)) {
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
  const candidates: Array<[unknown, unknown]> = [];
  for (const value of b) {
    if (value !== null && typeof value === "object") {
      candidates.push([value, undefined]);
    }
  }
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
    const current = left[i];
    if (current === undefined) {
      return false;
    }
    const [key, value] = current;
    for (let j = 0; j < right.length; j++) {
      if (used[j]) continue;
      const candidate = right[j];
      if (candidate === undefined) continue;
      const [otherKey, otherValue] = candidate;
      if (!compare(key, otherKey, ctx)) continue;
      if (value !== undefined || otherValue !== undefined) {
        if (!compare(value, otherValue, ctx)) continue;
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
function looseEqual(a: unknown, b: unknown, ctx: Context): boolean {
  if (a === b) {
    return true;
  }

  // `==` applies only when *both* sides are primitives. Comparing a primitive
  // against an object with it would make `'a'` loosely deep-equal to `['a']`,
  // because `['a'] == 'a'` coerces through `toString` -- and node says those
  // are not deep-equal, whatever `==` says about them.
  const aPrimitive = !isIndexableObject(a);
  const bPrimitive = !isIndexableObject(b);
  if (aPrimitive || bPrimitive) {
    if (aPrimitive && bPrimitive) {
      // eslint-disable-next-line eqeqeq
      return a == b ||
        (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));
    }
    return false;
  }
  if (!isIndexableObject(a) || !isIndexableObject(b)) {
    return false;
  }
  if (!supportedObjectKindsMatch(a, b)) {
    return false;
  }
  const known = ctx.seen.get(a);
  if (known?.has(b)) {
    return true;
  }
  ctx.seen.set(a, (known ?? new Set()).add(b));

  // Nothing to compare, and identity was ruled out above. The same hole as in
  // the strict walk, and it had to be closed twice because the two walks were
  // written separately -- which is the argument for the single dispatch node
  // has.
  if (isWeakMap(a) || isWeakSet(a) || isPromise(a) ||
      isWeakMap(b) || isWeakSet(b) || isPromise(b)) {
    return false;
  }

  // A `Date` with no own keys and `{}` both have zero enumerable properties,
  // so the key walk below would call them equal. Every kind whose *identity*
  // lives outside its properties has to be checked for symmetry first.
  // Guards, not answers: two regexps with the same source can still differ in
  // their own properties, and the key walk below is what sees that. Returning
  // early here made `/test/` equal to a `MyRegExp` carrying an extra field.
  if (isDate(a) || isDate(b)) {
    if (!isDate(a) || !isDate(b) || a.getTime() !== b.getTime()) {
      return false;
    }
  }
  if (isRegExp(a) || isRegExp(b)) {
    if (
      !isRegExp(a) || !isRegExp(b) ||
      a.source !== b.source || a.flags !== b.flags
    ) {
      return false;
    }
  }
  if (isURL(a) || isURL(b)) {
    if (!isURL(a) || !isURL(b) || a.href !== b.href) {
      return false;
    }
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || a.size !== b.size) {
      return false;
    }
  }
  if (isSet(a) || isSet(b)) {
    if (!isSet(a) || !isSet(b) || a.size !== b.size) {
      return false;
    }
  }
  if (isArrayBufferView(a) || isArrayBufferView(b)) {
    if (
      !isArrayBufferView(a) || !isArrayBufferView(b) ||
      !arrayBufferViewsShareKind(a, b)
    ) {
      return false;
    }
    if (!arrayBufferViewContentsEqual(a, b, true)) return false;
  }
  if (isAnyArrayBuffer(a) || isAnyArrayBuffer(b)) {
    if (
      !isAnyArrayBuffer(a) || !isAnyArrayBuffer(b) ||
      !arrayBuffersShareKind(a, b) ||
      !arrayBufferContentsEqual(a, b)
    ) {
      return false;
    }
  }
  const aIsError = isNativeError(a);
  const bIsError = isNativeError(b);
  if (aIsError || bIsError) {
    if (!aIsError || !bIsError || !errorsEqual(a, b, ctx)) {
      return false;
    }
  }
  // A boxed primitive has own index properties, so the key walk below matches
  // `new String('a')` against `{ 0: 'a' }`. What it wraps is what it is.
  if (isBoxedPrimitive(a) || isBoxedPrimitive(b)) {
    if (!isBoxedPrimitive(a) || !isBoxedPrimitive(b)) {
      return false;
    }
    if (!Object.is(a.valueOf(), b.valueOf())) {
      return false;
    }
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    if (!looseArrayElementsEqual(a, b, ctx)) {
      return false;
    }
  }
  // The same matching the strict walk uses. `has` and `get` find a member by
  // identity, and two structurally equal objects are not the same object -- so
  // a set of errors compared against an equal set of errors reported as
  // different, for every member that was not a primitive.
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || !mapsEqual(a, b, ctx)) {
      return false;
    }
  }
  if (isSet(a) || isSet(b)) {
    if (!isSet(a) || !isSet(b) || !setsEqual(a, b, ctx)) {
      return false;
    }
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    // Index keys were compared above, with the rule the array path has.
    if (Array.isArray(a) && indexKey.test(key)) {
      continue;
    }
    if (!looseEqual(a[key], b[key], ctx)) {
      return false;
    }
  }
  return true;
}

/**
 * Array elements, under `deepEqual`'s rule rather than the key walk's.
 *
 * The rule is not symmetric and that is node's, not a slip here:
 * `deepEqual([0], [null])` holds and `deepEqual([null], [0])` does not. A
 * `null` on the *expected* side matches an element that is anything, because a
 * hole reads as `undefined` and loose comparison has always treated the two as
 * interchangeable -- so a caller writing `[null]` for "a two-element array
 * whose second element I do not care about" has always worked. It applies to
 * array elements only; `{ a: 0 }` and `{ a: null }` are not loosely deep-equal.
 */
function looseArrayElementsEqual(a: unknown[], b: unknown[], ctx: Context): boolean {
  for (let i = 0; i < a.length; i++) {
    if (b[i] === undefined) {
      if (!Object.hasOwn(b, i)) {
        // A hole on the expected side, which matches a hole or `undefined`.
        if (Object.hasOwn(a, i) && a[i] !== undefined && a[i] !== null) {
          return false;
        }
        continue;
      }
      if (
        (a[i] !== undefined || !Object.hasOwn(a, i)) &&
        a[i] !== null
      ) {
        return false;
      }
    } else if (
      (a[i] === undefined || !looseEqual(a[i], b[i], ctx)) &&
      b[i] !== null
    ) {
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
  return looseEqual(a, b, { seen: new Map(), loose: true });
}

function partialErrorsEqual(actual: Error, expected: Error, seen: Cycles): boolean {
  if (expected.message !== "" && !partialEqual(actual.message, expected.message, seen)) {
    return false;
  }
  if (!partialEqual(actual.name, expected.name, seen)) {
    return false;
  }

  if (Object.hasOwn(expected, "cause")) {
    if (!Object.hasOwn(actual, "cause")) {
      return false;
    }
    // Node treats an explicitly present `undefined` as a presence constraint,
    // but it does not constrain the actual cause value.
    if (expected.cause !== undefined &&
        !partialEqual(actual.cause, expected.cause, seen)) {
      return false;
    }
  }

  if (expected instanceof AggregateError) {
    if (!(actual instanceof AggregateError)) {
      return false;
    }
    if (!partialEqual(
      aggregateMembers(actual),
      aggregateMembers(expected),
      seen,
    )) {
      return false;
    }
  }
  return true;
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
  if (!isIndexableObject(expected) || !isIndexableObject(actual)) {
    return false;
  }
  if (!supportedObjectKindsMatch(actual, expected)) {
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
    return isURL(actual) && actual.href === expected.href;
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
    if (!isArrayBufferView(actual) || !arrayBufferViewsShareKind(actual, expected)) {
      return false;
    }
    const wanted = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
    const found = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    return isSubsequence([...found], [...wanted], seen) && partialOwnKeys(actual, expected, seen, indexKey);
  }

  if (isAnyArrayBuffer(expected)) {
    if (!isAnyArrayBuffer(actual) || !arrayBuffersShareKind(actual, expected)) {
      return false;
    }
    return isSubsequence(
      [...new Uint8Array(actual)],
      [...new Uint8Array(expected)],
      seen,
    );
  }

  if (isBoxedPrimitive(expected)) {
    if (!isBoxedPrimitive(actual)) {
      return false;
    }
    if (!Object.is(actual.valueOf(), expected.valueOf())) {
      return false;
    }
  }

  if (isNativeError(expected)) {
    // The stack is left out: two errors raised from different lines are still
    // the same error as far as a comparison is concerned.
    if (!isNativeError(actual)) {
      return false;
    }
    if (!partialErrorsEqual(actual, expected, seen)) {
      return false;
    }
  }

  return partialOwnKeys(actual, expected, seen);
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
      out.push(array[Number(key)]);
    }
  }
  return out;
}

/** Pairs already on the stack, so a structure that points at itself terminates. */
type Cycles = Map<object, Set<object>>;

/**
 * A `URL` compares by its serialisation; its internals are derived from it.
 *
 * Structural recognition matches TypeScript's own type model and works for
 * both this runtime's URL and the host URL used by the TypeScript test path.
 */
interface URLValue extends IndexableObject {
  readonly href: string;
  readonly origin: string;
  toJSON(): string;
}

function isURL(value: unknown): value is URLValue {
  return isIndexableObject(value) &&
    "href" in value && typeof value.href === "string" &&
    "origin" in value && typeof value.origin === "string" &&
    "toJSON" in value && typeof value.toJSON === "function";
}

/**
 * Every own enumerable string key of `expected`, present on `actual` and
 * partially equal. `skip` drops keys compared some other way. Symbol-keyed
 * discovery is a §13 metaobject operation and is intentionally absent.
 */
function partialOwnKeys(
  actual: IndexableObject,
  expected: IndexableObject,
  seen: Cycles,
  skip?: RegExp,
): boolean {
  for (const key of Object.keys(expected)) {
    if (skip !== undefined && skip.test(key)) {
      continue;
    }
    if (!Object.hasOwn(actual, key)) {
      return false;
    }
    if (!partialEqual(actual[key], expected[key], seen)) {
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
      const candidate = found[i];
      if (candidate !== undefined && !used[i] && matches(item, candidate)) {
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
