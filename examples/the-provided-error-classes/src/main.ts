// Every error class this compiler provides, and the two properties the list as
// a whole has to have.
//
// `examples/syntax-error` covers what *one* provided class must do -- be
// constructible, catchable, and keep its `message` and `name`. This file covers
// the **list**, because two of its properties are not about any single class:
//
//   1. every class is distinguishable from every other, which is the entire
//      reason there is a list rather than one class. `assert.throws(fn,
//      TypeError)` is an `instanceof`, and code that branches on which error it
//      caught is ordinary;
//   2. the order is the identity. A class's position picks its type and its
//      constructor token, so the list is **append only** -- inserting one
//      renames every class after it, silently, and the rename is only visible
//      as an error of the wrong class being caught.
//
// `EvalError` and `ReferenceError` were added on 2026-09-11. They are one site
// each in `runtime/node`, which is not why they are here: a class absent from
// the list does not fail where it is thrown, it refuses its caller and its
// caller's caller, so a cheap one is worth having before something expensive is
// found behind it. `SyntaxError` was the demonstration -- one name in a list,
// and a specification-exact JSON parser and 120 refusals behind it.
//
// **`AggregateError` was added on 2026-09-13 and is the third demonstration**,
// found by following a chain rather than by counting throws. It is thrown
// almost nowhere; what its absence cost was three links away:
//
//     AggregateError absent from builtin::ERRORS
//       -> NodeAggregateError extends it, so has no layout
//          -> `value.code` over five instanceof-narrowed arms refuses, as
//             `code` on a union one of whose members has no layout
//             internal/errors.ts:1256, imported by every module
//
// A probe ruled out the obvious alternative first: a user class carrying an
// array field compiles and reads `.code` through a union perfectly well, so it
// was the base being unprovided and not the array, which is what the
// `instanceof` ledger row had reasonably guessed.
//
// It is also the first member whose layout is **not** two fields, and the first
// whose constructor puts `message` second -- see `aggregated` at the bottom.
// `SuppressedError` is the one still absent, for the same reason: three fields.
//
// The same list is read by the napi wrapper, which used to keep its own copy of
// it eight thousand lines away with its own arity in the type. It now reads
// `hir::PROVIDED_ERROR_NAMES`. A wrapper that disagreed with the compiler about
// which classes are provided would treat a provided one as user-declared, give
// it a different `name` and no `code`, and nothing here would have said so --
// which is why the copy is gone rather than merely corrected.

/** Each class, thrown and caught, answering its own position and no other's. */
export function whichOne(pick: number): number {
  const at = (((pick | 0) % 8) + 8) % 8;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    if (at === 6) throw new ReferenceError("f");
    throw new AggregateError([new Error("inner")], "g");
  } catch (error) {
    // Ordered most specific first: every one of these is an `Error`, so asking
    // `instanceof Error` earlier would answer 1 for all eight and the test
    // would pass while distinguishing nothing.
    if (error instanceof TypeError) return 2;
    if (error instanceof RangeError) return 3;
    if (error instanceof URIError) return 4;
    if (error instanceof SyntaxError) return 5;
    if (error instanceof EvalError) return 6;
    if (error instanceof ReferenceError) return 7;
    if (error instanceof AggregateError) return 8;
    if (error instanceof Error) return 1;
    return 0;
  }
}

/** Each class is an `Error`, which the ordering above deliberately hides. */
export function everyOneIsAnError(pick: number): number {
  const at = (((pick | 0) % 8) + 8) % 8;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    if (at === 6) throw new ReferenceError("f");
    throw new AggregateError([new Error("inner")], "g");
  } catch (error) {
    return error instanceof Error ? 1 : 0;
  }
}

/** `message` survives, built rather than a literal. */
export function messageLength(n: number): number {
  const at = (n | 0) % 100;
  try {
    throw new EvalError("bad call at " + at);
  } catch (error) {
    return error instanceof Error ? error.message.length : -1;
  }
}

/**
 * `name` survives, and the list's names are deliberately unlike in length --
 * `ReferenceError` is 14 characters, `AggregateError` 14, and `Error` 5, so a
 * class whose `name` came from the wrong position answers a different number
 * here. The two fourteens are why `whichOne` exists beside this: two classes
 * whose names are the same length are indistinguishable to this function and
 * not to that one.
 */
export function nameLength(pick: number): number {
  const at = (((pick | 0) % 8) + 8) % 8;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    if (at === 6) throw new ReferenceError("f");
    throw new AggregateError([new Error("inner")], "g");
  } catch (error) {
    return error instanceof Error ? error.name.length : -1;
  }
}

/**
 * Used as a *value* rather than constructed -- one object per class, compared
 * by address.
 *
 * **Written without an array on purpose.** The obvious spelling collects the
 * seven into a literal and counts matches, and on the JVM that array takes its
 * element type from the first entry, so storing a `Ctor_TypeError` into a
 * `Ctor_Error[]` throws `ArrayStoreException`. That is Java array covariance
 * and it is a real gap, but it is not *this* file's subject: an example that
 * failed for it would report the error classes as broken on one backend when
 * what is broken is arrays of unlike references.
 *
 * Counting distinct pairs instead asks exactly the question -- are these seven
 * names seven objects -- and asks nothing else. Two classes sharing an object
 * would answer fewer than 21.
 */
export function asValues(n: number): number {
  const a = Error;
  const b = TypeError;
  const c = RangeError;
  const d = URIError;
  const e = SyntaxError;
  const f = EvalError;
  const g = ReferenceError;
  let distinct = 0;
  if (a !== b) distinct++;
  if (a !== c) distinct++;
  if (a !== d) distinct++;
  if (a !== e) distinct++;
  if (a !== f) distinct++;
  if (a !== g) distinct++;
  if (b !== c) distinct++;
  if (b !== d) distinct++;
  if (b !== e) distinct++;
  if (b !== f) distinct++;
  if (b !== g) distinct++;
  if (c !== d) distinct++;
  if (c !== e) distinct++;
  if (c !== f) distinct++;
  if (c !== g) distinct++;
  if (d !== e) distinct++;
  if (d !== f) distinct++;
  if (d !== g) distinct++;
  if (e !== f) distinct++;
  if (e !== g) distinct++;
  if (f !== g) distinct++;
  // **The eighth is deliberately not here, and the reason is a result.**
  // `AggregateError` takes its errors first, so `AggregateErrorConstructor`
  // shares no call signature with the other seven and TypeScript rejects the
  // comparison outright:
  //
  //     TS2367 This comparison appears to be unintentional because the types
  //            'EvalErrorConstructor' and 'AggregateErrorConstructor' have no
  //            overlap.
  //
  // Which answers this function's question before it runs. The distinctness
  // these twenty-one pairs test is a run-time fact about addresses, needed
  // because the other seven *are* mutually assignable and so could be one
  // object without the checker minding. The eighth cannot be confused with
  // them by construction.
  // And the same name twice is the same object, which is the other half of
  // "one immortal object per class" and the half a distinctness count alone
  // would not catch.
  return distinct + (Error === Error ? 100 : 0) + n * 0;
}

/** Returned rather than thrown, which is how a helper hands one back. */
function make(message: string): ReferenceError {
  return new ReferenceError(message);
}

export function built(n: number): number {
  return make("x " + (n | 0)).message.length;
}

/**
 * The one class in the list whose layout is **not** two fields.
 *
 * Every other provided error holds `{ message, name }` and nothing else, which
 * is the premise `builtin::error_fields` was written on. `AggregateError`
 * carries the errors it aggregates, and `SuppressedError` — still absent —
 * carries two more, so the list's shape is what kept both out rather than
 * anybody's backlog.
 *
 * Three array lengths, and the answer is the **message** length rather than the
 * array's. `errors` is stored erased and reading it back is refused — see
 * `blockers/an-aggregate-errors-read`, which has the reason and the pair of
 * backend behaviours that made a refusal the right answer rather than a
 * limitation to leave alone.
 *
 * So what three lengths buy here is narrower than it looks and is still worth
 * having: the store must not disturb the two fields beside it, and an array
 * written into an erased slot must survive construction, `throw` and `catch`
 * without taking `message` with it.
 *
 * The constructor's **message is second**, which is the whole of what made this
 * more than one name in a list: `new Error(message?, options?)` against
 * `new AggregateError(errors, message?, options?)`. The options check counted
 * arguments from a constant and refused this as "an `Error` with options" until
 * it counted from where the options argument actually is.
 */
export function aggregated(n: number): number {
  const at = (((n | 0) % 3) + 3) % 3;
  try {
    if (at === 0) throw new AggregateError([new Error("a")], "one");
    if (at === 1) throw new AggregateError([new Error("a"), new TypeError("b")], "two");
    throw new AggregateError(
      [new Error("a"), new TypeError("b"), new RangeError("c")],
      "three",
    );
  } catch (error) {
    if (error instanceof AggregateError) {
      return error.message.length;
    }
    return -1;
  }
}
