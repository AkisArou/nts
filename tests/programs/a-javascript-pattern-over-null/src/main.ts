// A destructuring pattern in a JavaScript file meeting `null`.
//
// An array pattern runs `GetIterator` on its value and an object pattern runs
// `RequireObjectCoercible`, and over `null` or `undefined` both throw a
// `TypeError`. The checker infers a `.js` file's types and nothing checks them,
// so `function nestedArray([[x]])` is typed `[[any]]` and still meets `[null]`.
// This compiler trusted the type and read the inner array without a test: no
// throw, a read of nothing. In a JavaScript source every pattern is now tested
// before it reads; a `.ts` file's types are the guarantee, so a TypeScript
// program -- the runtime included -- emits exactly what it did.
//
// What each export pins (1 for "returned", 2 for a `TypeError`, 3 for anything
// else; plus the argument):
//
//   nested     `[[x]]` over `[null]`: the inner array pattern throws
//   inObject   `[{ w }]` over `[null]`: an object pattern inside an array one
//   arrayOfIt  `{ w: [x] }` over `{ w: null }`: an array pattern inside an
//              object one
//   present    the same pattern over a value that is there returns it
//
// Transcribed from node (v24), each export called with 3:
//
//     nested 5    inObject 5    arrayOfIt 5    present 10
import { arrayInObject, nestedArray, objectInArray } from "./patterns.js";

// Each call is made inside the `try` itself: a closure calling a throwing
// function imported from another module cannot carry its throw yet, a gap of
// its own (see the plan's 2026-10-03 entries), and not this example's subject.
export function nested(n: number): number {
  try {
    // @ts-expect-error TS2322: the null a JavaScript caller can pass
    nestedArray([null]);
    return 1 + n;
  } catch (e) {
    return (e instanceof TypeError ? 2 : 3) + n;
  }
}

export function inObject(n: number): number {
  try {
    // @ts-expect-error TS2322: the null a JavaScript caller can pass
    objectInArray([null]);
    return 1 + n;
  } catch (e) {
    return (e instanceof TypeError ? 2 : 3) + n;
  }
}

export function arrayOfIt(n: number): number {
  try {
    // @ts-expect-error TS2322: the null a JavaScript caller can pass
    arrayInObject({ w: null });
    return 1 + n;
  } catch (e) {
    return (e instanceof TypeError ? 2 : 3) + n;
  }
}

export function present(n: number): number {
  return (nestedArray([[7]]) === 7 ? 7 : 0) + n;
}
