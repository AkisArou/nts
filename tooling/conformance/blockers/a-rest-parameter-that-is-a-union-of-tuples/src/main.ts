// expect: a rest parameter whose element type has no representation
//
// `constructor(...given: [] | [input: string, base?: string | URL])` is how
// this tree writes "and tell me whether I was called with no arguments at all".
// The union of tuples is what makes `given.length === 0` a *type* the checker
// can narrow, so the `ERR_MISSING_ARGS` branch is reachable without consulting
// `arguments`.
//
// `lower_param` requires a rest parameter's type to be `Array(_)`. A union is
// not one, so the whole function refuses.
//
// # What it is under
//
//     URL#constructor -> fileURLToPath, fileURLToPathBuffer, pathToFileURL
//
// and `net`'s `SocketAddress.parse`, which was rewritten on 2026-09-10 to parse
// through `URL` and is correct on the interpreted lane while not lowering at
// all. `URL` publishes no wrapper: "is a class whose constructor was not
// compiled".
//
// Thirteen sites across four modules, and **every one of them uses the binder
// only through `.length` and a constant index** -- no site spreads it, iterates
// it, or passes it on. The array is never needed as a value.
//
// # What was fixed, and what this fixture now holds
//
// The first version of this file recorded `homogeneousUnion` as refused too --
// `[] | [number]`, element type `number` in **both** arms, nothing
// heterogeneous about it and nothing unrepresentable. It refused because the
// check asked whether the *parameter's own type* is an array, and a union never
// is, so the arms were never looked at. **The message named the wrong half.**
//
// That half is fixed: a union every one of whose arms is a tuple or an array,
// and every one of whose positions represents the same way, is an array of that
// -- which is what a rest parameter already is. Six methods in
// `runtime/node/url/src/searchparams.ts` lower because of it, `append` and `set`
// among them, whose three arms `[] | [name: string] | [name: string, value:
// string]` are all `string`.
//
// `examples/a-rest-parameter-written-as-a-union-of-tuples` is the guard, and it
// checks the *count* rather than the lowering: a rest parameter is gathered at
// the call site into a real array, so `given.length` is the number of arguments
// actually supplied.
//
// What is left is the heterogeneous case, which is the one `URL` needs.
//
// # Why the count has to be exact
//
// The obvious shortcut -- treat the tuple as optional parameters and let
// `given.length` mean "how many leading arguments were not `undefined`" -- is
// wrong, and `runtime/node/url/src/searchparams.ts` is where it shows. Six
// sites there compare `given.length < 2`, and `form-data.ts` compares
// `args.length > 1`. Node's `URLSearchParams#set("a")` throws while
// `set("a", undefined)` sets the string `"undefined"`, and that distinction is
// exactly what `< 2` implements. A count derived from the values cannot tell
// those apart; only the number of arguments actually supplied can.
//
// `url.ts` itself only ever compares `=== 0`, so a shortcut would have looked
// right in the module that motivated the work and been wrong six lines away.
//
// # A second, narrower refusal reached by the same fix
//
// `optionalTail("a", undefined)` -- an explicit `undefined` in a position whose
// element type is `string` -- refuses with ``NTS1001 `null` or `undefined`
// where what it stands in for is not a reference``. Node counts that as two
// arguments and it is exactly the call `URLSearchParams#delete(name, undefined)`
// makes, so it is not hypothetical.
//
// It is prose here rather than a function because this fixture asserts one
// expectation and a second refusal in the same file would be asserted by
// nobody. It is also not in the example, for the opposite reason: a refused
// function leaves the differential silently, so the example would report
// agreement over the functions that survived and go green having stopped
// testing the thing it was written for.
//
// No `runtime/node` call site passes `undefined` explicitly -- checked by the
// Node lane rather than assumed: there is no two-argument `.delete(` in any
// `runtime/node` TypeScript file, and `searchParams` does not appear outside
// `url` at all.
//
// **The day it costs something is not the day `URLSearchParams` publishes.** It
// is the day a *node test* calls `delete` with two arguments through the napi
// wrapper, which builds the array from `argc` and does not take this path.
// `runtime/node` will never be the caller, because the only caller that would
// is JavaScript. So the exposure is entirely on the conformance side and none
// of it is in code anyone would be editing -- which is a different statement
// from "no call site today", and it is the one that decides whether anything
// needs doing about it. Nothing does.
//
// # What it would take
//
// Every call site knows its own argument count at compile time, and the napi
// wrapper is handed `argc`. So the count is available everywhere it is needed
// without asking a backend for anything: lowering can replace the rest binder
// with one synthesized count parameter plus one parameter per tuple position,
// rewrite `given.length` and `given[k]` against them, and fill the count at
// each call. Every backend then sees an ordinary function with ordinary
// parameters and needs no change -- which is the reason to do it in lowering
// rather than in the calling convention.
//
// It is filed rather than started because it is a lowering change with a real
// precondition: it holds only while the binder is used through `.length` and
// constant indices, and anything else has to keep refusing rather than lower
// to something that quietly drops arguments.

/** Control: an ordinary rest parameter. Lowers. */
export function ordinaryRest(...args: number[]): number {
  let total = 0;
  for (let i = 0; i < args.length; i++) total += args[i]!;
  return total;
}

/** Control: a *tuple* rest parameter. Lowers -- a tuple is an array here. */
export function tupleRest(...args: [number, number]): number {
  return args[0] + args[1] + args.length;
}

/**
 * Control: the half that was fixed. Both arms have element type `number`, so
 * this is `number[]` with a length the checker can narrow on. Lowers.
 */
export function homogeneousUnion(...given: [] | [number]): number {
  if (given.length === 0) return -1;
  return given[0];
}

/**
 * Control: three arms, all `string`. `URLSearchParams#append` and `#set` are
 * written this way and lower.
 */
export function multiArmHomogeneous(
  ...given: [] | [a: string] | [a: string, b: string]
): number {
  return given.length;
}

/**
 * Under test: positions that do not agree. `URL#constructor`'s
 * `[] | [input: string, base?: string | URL]` holds `string` at one position
 * and `string | URL | undefined` at the other, and there is no element type
 * that is both.
 *
 * A number and an object here, for the same reason and more cheaply.
 */
export function unionOfTuples(...given: [] | [a: number, b?: { x: number }]): number {
  if (given.length === 0) return -1;
  if (given.length < 2) return given[0];
  return given[0] + given[1]!.x;
}
